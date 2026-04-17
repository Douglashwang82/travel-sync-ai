// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — per-source runner
//
// Pipeline for one tracking_lists row:
//   1. fetch (fetchers.ts)         → raw items + content_hash
//   2. dedupe vs. previous snapshot (skip if hash unchanged)
//   3. insert tracking_snapshots row
//   4. extract structured items via LLM (extractor.ts)
//   5. insert tracking_items rows (dedup on external_id)
//   6. return new item ids for the digest composer
//
// Called by:
//   - cron/tracking-digest (batched, all active lists due for refresh)
//   - manual trigger from the LIFF "run now" button
// ─────────────────────────────────────────────────────────────────────────────

import type { TrackingList } from "./types";

export interface RunnerResult {
  list_id: string;
  status: "success" | "skipped" | "failed";
  new_item_ids: string[];
  error?: string;
}

export async function runTrackingList(_list: TrackingList): Promise<RunnerResult> {
  // TODO: implement the 6-step pipeline above. Record tracking_runs row at
  // start + finish; increment consecutive_failures on error and deactivate
  // after 5 consecutive failures (disaster-recovery: avoids blasting a dead
  // source with requests).
  throw new Error("runTrackingList: not implemented");
}
