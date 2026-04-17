// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — daily digest composer
//
// Groups today's new tracking_items per user, has Gemini produce a short
// traditional-Chinese summary, persists to tracking_digests, and pushes
// through LINE 1:1 DM.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import { pushText } from "@/lib/line";
import { captureError } from "@/lib/monitoring";

const MAX_ITEMS_PER_DIGEST = 12;
const LINE_TEXT_CAP = 4800;      // LINE hard limit is 5000; keep headroom

export interface DigestResult {
  line_user_id: string;
  item_count: number;
  delivered: boolean;
  skipped_reason?: "no_items" | "already_sent" | "llm_unavailable" | "push_failed";
}

export async function composeAndSendDigest(
  lineUserId: string
): Promise<DigestResult> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD, UTC

  // Idempotency: one digest per user per day.
  const { data: existing } = await db
    .from("tracking_digests")
    .select("id, delivered_at")
    .eq("line_user_id", lineUserId)
    .eq("digest_date", today)
    .maybeSingle();

  if (existing?.delivered_at) {
    return { line_user_id: lineUserId, item_count: 0, delivered: false, skipped_reason: "already_sent" };
  }

  // Today's new items, scoped to the caller's own lists.
  const startOfToday = `${today}T00:00:00Z`;
  const { data: items } = await db
    .from("tracking_items")
    .select(
      `id, title, summary, url, category, location, tags, first_seen_at,
       tracking_lists!inner ( id, line_user_id, display_name, source_url )`
    )
    .eq("tracking_lists.line_user_id", lineUserId)
    .gte("first_seen_at", startOfToday)
    .order("first_seen_at", { ascending: false })
    .limit(MAX_ITEMS_PER_DIGEST);

  if (!items || items.length === 0) {
    return { line_user_id: lineUserId, item_count: 0, delivered: false, skipped_reason: "no_items" };
  }

  // ─── LLM summary ──────────────────────────────────────────────────────────
  let summary: string;
  try {
    summary = await generateSummary(items);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return { line_user_id: lineUserId, item_count: items.length, delivered: false, skipped_reason: "llm_unavailable" };
    }
    captureError(err, { context: "tracking_digest_llm", lineUserId });
    summary = fallbackSummary(items);
  }

  const finalText = truncate(summary, LINE_TEXT_CAP);

  // ─── Persist digest row BEFORE push (so we can retry) ─────────────────────
  const digestRow = {
    line_user_id: lineUserId,
    group_id: null as string | null,
    digest_date: today,
    item_ids: items.map((i) => i.id),
    summary_markdown: finalText,
  };

  const { data: digest, error: insertErr } = await db
    .from("tracking_digests")
    .upsert(digestRow, { onConflict: "line_user_id,digest_date" })
    .select("id")
    .single();

  if (insertErr) {
    captureError(insertErr, { context: "tracking_digest_insert", lineUserId });
    return { line_user_id: lineUserId, item_count: items.length, delivered: false, skipped_reason: "push_failed" };
  }

  // ─── LINE push (1:1 DM) ────────────────────────────────────────────────────
  try {
    await pushText(lineUserId, finalText);
  } catch (err) {
    captureError(err, { context: "tracking_digest_push", lineUserId });
    return { line_user_id: lineUserId, item_count: items.length, delivered: false, skipped_reason: "push_failed" };
  }

  if (digest?.id) {
    await db
      .from("tracking_digests")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", digest.id);
  }

  return { line_user_id: lineUserId, item_count: items.length, delivered: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DigestItem = {
  title: string;
  summary: string | null;
  url: string | null;
  category: string | null;
  location: string | null;
  tags: string[] | null;
  tracking_lists:
    | { display_name: string | null; source_url: string }
    | { display_name: string | null; source_url: string }[];
};

const SYSTEM_PROMPT = `You write a concise daily digest for a travel planner.
Output plain text (LINE-safe, no markdown tables). Use Traditional Chinese.
Structure:
  一行標題（含 emoji ✈️🍜🗺️ 視類別而定）
  ─────
  • 每則項目：**標題** — 一句話摘要（location 若有則附括號）
    連結：<url>

Keep it tight — skim-friendly, 60–120 zh chars per item max.`;

async function generateSummary(items: DigestItem[]): Promise<string> {
  const lines = items.map((it, i) => {
    const list = Array.isArray(it.tracking_lists) ? it.tracking_lists[0] : it.tracking_lists;
    const src = list?.display_name || list?.source_url || "unknown";
    return [
      `[${i + 1}] ${it.title}`,
      it.summary ? `  summary: ${it.summary}` : "",
      it.category ? `  category: ${it.category}` : "",
      it.location ? `  location: ${it.location}` : "",
      it.tags?.length ? `  tags: ${it.tags.join(", ")}` : "",
      it.url ? `  url: ${it.url}` : "",
      `  source: ${src}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const user = `Today's new items (${items.length}):\n\n${lines.join("\n\n")}`;
  return await generateText(SYSTEM_PROMPT, user);
}

function fallbackSummary(items: DigestItem[]): string {
  const header = `✈️ 今日追蹤（${items.length} 則）\n─────`;
  const body = items
    .map((it) => {
      const loc = it.location ? `（${it.location}）` : "";
      const url = it.url ? `\n${it.url}` : "";
      return `• ${it.title}${loc}\n${it.summary ?? ""}${url}`;
    })
    .join("\n\n");
  return `${header}\n${body}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
