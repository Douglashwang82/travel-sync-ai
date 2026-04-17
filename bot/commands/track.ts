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
    await reply("I can't identify who you are — try again from a LINE group chat.");
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
      "📡 You're not tracking anything yet.\n\n" +
      "Add a source: /track add https://some-travel-blog.com\n" +
      "Or open the Tracking page in LIFF for more options."
    );
    return;
  }

  const lines: string[] = [`📡 Tracking ${data.length} source${data.length === 1 ? "" : "s"}:`];
  data.forEach((row, i) => {
    const status = row.is_active ? "" : " (paused)";
    const fails = row.consecutive_failures > 0 ? ` ⚠️${row.consecutive_failures}` : "";
    const last = row.last_success_at ? relativeTime(row.last_success_at) : "never";
    lines.push(
      `${i + 1}. [${row.source_type}] ${row.category}${status}${fails}\n` +
      `   ${truncate(row.source_url, 60)}\n` +
      `   last: ${last}`
    );
  });
  lines.push("\nAdd more with /track add <url>\nOpen the LIFF Tracking page to pause or delete.");

  await reply(lines.join("\n"));
}

async function trackAdd(
  lineUserId: string,
  rest: string[],
  reply: (text: string) => Promise<void>
): Promise<void> {
  const url = rest.find((a) => URL_RE.test(a));
  if (!url) {
    await reply("Usage: /track add <url> [category]\nExample: /track add https://www.timeout.com/tokyo/restaurants restaurant");
    return;
  }

  if (/^https?:\/\/([^/]+\.)?threads\.(net|com)\//i.test(url)) {
    await reply(
      "Threads isn't supported yet — Meta's Threads API has no public discovery endpoint. Try Instagram (Business/Creator accounts only) or an RSS feed instead."
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
      await reply("You're already tracking that URL.");
      return;
    }
    await reply("Couldn't add that source. Check the URL and try again.");
    return;
  }

  await reply(
    `📡 Added (${sourceType}, ${category})\n${truncate(url, 80)}\n\n` +
    "Use /track run to fetch it now, or wait for the daily digest."
  );
}

async function trackRun(
  lineUserId: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const result = await composeAndSendDigest(lineUserId);

  if (result.delivered) {
    await reply(`📬 Sent today's digest (${result.item_count} items) to your LINE chat with me.`);
    return;
  }
  switch (result.skipped_reason) {
    case "already_sent":
      await reply("📬 Today's digest already went out — check your 1:1 chat with me.");
      return;
    case "no_items":
      await reply("Nothing new today. Add a source with /track add <url> or wait until tomorrow.");
      return;
    case "llm_unavailable":
      await reply("The summary service is temporarily unavailable. Try again in a minute.");
      return;
    default:
      await reply("Couldn't send the digest right now. Please try again shortly.");
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
    "📡 /track — follow websites & feeds for daily travel info",
    "",
    "/track             list your sources",
    "/track add <url>   add a source (category optional)",
    "/track run         send today's digest to your DM",
    "",
    "Open the LIFF Tracking page to pause or delete sources.",
  ].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
