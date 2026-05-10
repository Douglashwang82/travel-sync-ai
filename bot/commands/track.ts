import { createAdminClient } from "@/lib/db";
import { composeAndSendDigest } from "@/services/tracking/digest";
import type { CommandContext } from "../router";

const URL_RE = /^https?:\/\/.+/i;
const MAX_LIST = 10;

type Category = "travel" | "restaurant" | "attraction" | "event" | "other";
const CATEGORIES: readonly Category[] = [
  "travel", "restaurant", "attraction", "event", "other",
];

/**
 * /track                → list caller's tracked sources
 * /track add <url> [cat] → add a source (auto-detects website vs rss)
 * /track run             → compose + send today's digest to the caller's DM
 * /track <anything>      → short help
 *
 * Subscriptions are per-user (not per-group). Reply is always in-group
 * (reply token), but digest delivery happens via 1:1 DM.
 */
export async function handleTrack(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.userId) {
    await reply("無法辨識你的身分，請從 LINE 群組聊天再試一次。");
    return;
  }

  const [sub, ...rest] = args;
  const verb = (sub ?? "list").toLowerCase();

  switch (verb) {
    case "list":
      await trackList(ctx.userId, reply);
      return;
    case "add":
      await trackAdd(ctx.userId, rest, reply);
      return;
    case "run":
    case "digest":
      await trackRun(ctx.userId, reply);
      return;
    default:
      await reply(usage());
  }
}

async function trackList(
  lineUserId: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const db = createAdminClient();
  const { data } = await db
    .from("tracking_lists")
    .select("id, source_type, source_url, category, is_active, last_success_at, consecutive_failures")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(MAX_LIST);

  if (!data || data.length === 0) {
    await reply(
      "📡 你還沒有追蹤任何來源。\n\n" +
      "新增來源：/track add https://some-travel-blog.com"
    );
    return;
  }

  const lines: string[] = [`📡 目前追蹤 ${data.length} 個來源：`];
  data.forEach((row, i) => {
    const status = row.is_active ? "" : "（已暫停）";
    const fails = row.consecutive_failures > 0 ? ` ⚠️${row.consecutive_failures}` : "";
    const last = row.last_success_at ? relativeTime(row.last_success_at) : "從未";
    lines.push(
      `${i + 1}. [${row.source_type}] ${row.category}${status}${fails}\n` +
      `   ${truncate(row.source_url, 60)}\n` +
      `   上次：${last}`
    );
  });
  lines.push("\n新增更多：/track add <網址>");

  await reply(lines.join("\n"));
}

async function trackAdd(
  lineUserId: string,
  rest: string[],
  reply: (text: string) => Promise<void>
): Promise<void> {
  const url = rest.find((a) => URL_RE.test(a));
  if (!url) {
    await reply("用法：/track add <url> [分類]\n範例：/track add https://www.timeout.com/tokyo/restaurants restaurant");
    return;
  }

  if (/^https?:\/\/([^/]+\.)?threads\.(net|com)\//i.test(url)) {
    await reply(
      "Threads 目前不支援 — Meta 的 Threads API 沒有公開的發現介面。可以改用 Instagram（僅限商業／創作者帳號）或 RSS 來源。"
    );
    return;
  }

  const categoryArg = rest.find((a) => !URL_RE.test(a))?.toLowerCase() as Category | undefined;
  const category: Category = categoryArg && CATEGORIES.includes(categoryArg) ? categoryArg : "travel";
  const sourceType = detectSourceType(url);

  const db = createAdminClient();
  const { error } = await db.from("tracking_lists").insert({
    line_user_id: lineUserId,
    source_type: sourceType,
    source_url: url,
    category,
  });

  if (error) {
    if (error.code === "23505") {
      await reply("你已經在追蹤這個網址了。");
      return;
    }
    await reply("新增來源失敗，請檢查網址後再試一次。");
    return;
  }

  await reply(
    `📡 已新增（${sourceType}、${category}）\n${truncate(url, 80)}\n\n` +
    "使用 /track run 立即抓取，或等候每日摘要。"
  );
}

async function trackRun(
  lineUserId: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const result = await composeAndSendDigest(lineUserId);

  if (result.delivered) {
    await reply(`📬 今日摘要（${result.item_count} 則）已送到你和我的 1:1 聊天。`);
    return;
  }
  switch (result.skipped_reason) {
    case "already_sent":
      await reply("📬 今日摘要已經送出，請查看你和我的 1:1 聊天。");
      return;
    case "no_items":
      await reply("今天沒有新內容。可以用 /track add <網址> 新增來源，或等到明天。");
      return;
    case "llm_unavailable":
      await reply("摘要服務暫時無法使用，請稍後再試。");
      return;
    default:
      await reply("目前無法送出摘要，請稍後再試一次。");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectSourceType(
  url: string
): "website" | "rss" | "youtube" | "instagram" {
  const lower = url.toLowerCase();
  if (/^https?:\/\/([^/]+\.)?youtube\.com\//.test(lower)) return "youtube";
  if (/^https?:\/\/([^/]+\.)?instagram\.com\//.test(lower)) return "instagram";
  if (/\/(feed|rss|atom)\/?($|\?)/.test(lower)) return "rss";
  if (/\.(xml|rss|atom)($|\?)/.test(lower)) return "rss";
  return "website";
}

export const __test = { detectSourceType };

function usage(): string {
  return [
    "📡 /track — 追蹤網站與訂閱來源，獲取每日旅遊資訊",
    "",
    "/track             列出你目前的來源",
    "/track add <網址>  新增來源（分類可選）",
    "/track run         立刻把今日摘要送到你的私訊",
  ].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}
