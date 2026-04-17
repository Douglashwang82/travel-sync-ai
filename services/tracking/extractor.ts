// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — LLM extractor
//
// Given raw FetchedItem[] (output of a fetcher), use Gemini 2.0 Flash to
// produce ExtractedItem[]: a one-line summary, category, venue, tags.
// Called once per source per run, batched to minimise LLM cost.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtractedItem, FetchedItem, TrackingList } from "./types";

export async function extractItems(
  _list: TrackingList,
  _items: FetchedItem[]
): Promise<ExtractedItem[]> {
  // TODO: call generateJson<ExtractedItem[]>() from lib/gemini.ts with a
  // schema-constrained prompt. Truncate body_text to ~500 tokens per item,
  // cap batch at ~20 items. See docs/tracking-list.md for prompt design.
  throw new Error("extractItems: not implemented");
}
