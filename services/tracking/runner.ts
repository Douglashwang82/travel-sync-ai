// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — per-source runner
//
// Pipeline for one tracking_lists row:
//   1. fetch           → raw items + content_hash
//   2. dedupe vs. last snapshot (skip LLM + writes if hash unchanged)
//   3. insert tracking_snapshots
//   4. extract via LLM (website source only in MVP)
//   5. upsert tracking_items (dedup on external_id)
//   6. update tracking_lists counters + tracking_runs log
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { GeminiUnavailableError } from "@/lib/gemini";
import { fetchers } from "./fetchers";
import { extractItems } from "./extractor";
import type { ExtractedItem, FetchedItem, TrackingList } from "./types";

const MAX_CONSECUTIVE_FAILURES = 5;

export interface RunnerResult {
  list_id: string;
  status: "success" | "skipped" | "failed";
  new_item_ids: string[];
  error?: string;
}

export async function runTrackingList(list: TrackingList): Promise<RunnerResult> {
  const db = createAdminClient();
  const { data: runRow } = await db
    .from("tracking_runs")
    .insert({ tracking_list_id: list.id, status: "running" })
    .select("id")
    .single();
  const runId = runRow?.id as string | undefined;

  try {
    const fetcher = fetchers[list.source_type];
    const fetched = await fetcher(list.source_url);

    if (fetched.http_status >= 400 || fetched.items.length === 0) {
      return await finish(db, list, runId, {
        status: "failed",
        new_item_ids: [],
        error: `fetch failed (${fetched.http_status}) ${fetched.raw_excerpt.slice(0, 200)}`,
      });
    }

    // ─── Dedupe vs. last snapshot ───────────────────────────────────────────
    const { data: lastSnap } = await db
      .from("tracking_snapshots")
      .select("content_hash")
      .eq("tracking_list_id", list.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSnap?.content_hash && lastSnap.content_hash === fetched.content_hash) {
      return await finish(db, list, runId, {
        status: "skipped",
        new_item_ids: [],
      });
    }

    // ─── Persist snapshot ───────────────────────────────────────────────────
    const { data: snap } = await db
      .from("tracking_snapshots")
      .insert({
        tracking_list_id: list.id,
        http_status: fetched.http_status,
        content_hash: fetched.content_hash,
        raw_excerpt: fetched.raw_excerpt,
        item_count: 0,
      })
      .select("id")
      .single();
    const snapshotId = snap?.id as string | undefined;

    // ─── Extraction ─────────────────────────────────────────────────────────
    // Website: one HTML page → let the LLM split + summarise.
    // RSS / YouTube: already item-shaped (each row is a post / video) →
    // bypass the LLM entirely. The list's default category/region is used.
    const extracted =
      list.source_type === "rss" || list.source_type === "youtube"
        ? mapFeedItems(list, fetched.items)
        : await extractItems(list, fetched.items);

    if (extracted.length === 0) {
      return await finish(db, list, runId, {
        status: "skipped",
        new_item_ids: [],
      });
    }

    // ─── Upsert tracking_items (external_id is unique per list) ─────────────
    const rows = extracted.map((it) => ({
      tracking_list_id: list.id,
      snapshot_id: snapshotId,
      external_id: it.external_id,
      title: it.title,
      summary: it.summary,
      url: it.url,
      image_url: it.image_url,
      category: it.category,
      location: it.location,
      tags: it.tags,
    }));

    const { data: upserted, error: upsertErr } = await db
      .from("tracking_items")
      .upsert(rows, {
        onConflict: "tracking_list_id,external_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (upsertErr) throw upsertErr;

    const newIds = (upserted ?? []).map((r) => r.id as string);

    if (snapshotId) {
      await db
        .from("tracking_snapshots")
        .update({ item_count: rows.length })
        .eq("id", snapshotId);
    }

    return await finish(db, list, runId, {
      status: "success",
      new_item_ids: newIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof GeminiUnavailableError)) {
      captureError(err, { context: "tracking_runner", list_id: list.id });
    }
    return await finish(db, list, runId, {
      status: "failed",
      new_item_ids: [],
      error: msg,
    });
  }
}

// Bypass the LLM for feed-style sources: items arrive pre-split and
// pre-summarised. We copy through title/summary/url/published_at as-is and
// fall back to the list's category + region since feeds don't tell us
// those. A cheap enrichment pass can be added later if needed.
function mapFeedItems(list: TrackingList, items: FetchedItem[]): ExtractedItem[] {
  return items
    .filter((it) => it.title)
    .map((it) => ({
      external_id: normaliseExternalId(it.external_id ?? it.url ?? it.title),
      title: it.title.slice(0, 200),
      summary: it.body_text.slice(0, 400),
      url: it.url,
      image_url: it.image_url,
      category: list.category,
      location: list.region ?? null,
      tags: [],
    }));
}

function normaliseExternalId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\-_/:.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200) || "unknown";
}

type Finish = Omit<RunnerResult, "list_id">;

async function finish(
  db: ReturnType<typeof createAdminClient>,
  list: TrackingList,
  runId: string | undefined,
  result: Finish
): Promise<RunnerResult> {
  const now = new Date().toISOString();

  if (runId) {
    await db
      .from("tracking_runs")
      .update({
        status: result.status,
        finished_at: now,
        new_item_count: result.new_item_ids.length,
        error: result.error ?? null,
      })
      .eq("id", runId);
  }

  const nextFailures =
    result.status === "success" || result.status === "skipped"
      ? 0
      : list.consecutive_failures + 1;

  await db
    .from("tracking_lists")
    .update({
      last_run_at: now,
      last_success_at: result.status === "success" ? now : list.last_success_at,
      consecutive_failures: nextFailures,
      is_active: nextFailures >= MAX_CONSECUTIVE_FAILURES ? false : list.is_active,
      updated_at: now,
    })
    .eq("id", list.id);

  return { list_id: list.id, ...result };
}
