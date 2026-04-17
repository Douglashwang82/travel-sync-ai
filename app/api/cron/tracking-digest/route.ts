import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/monitoring";
import { runTrackingList } from "@/services/tracking/runner";
import type { TrackingList } from "@/services/tracking/types";

const BATCH_SIZE = 30;
const CONCURRENCY = 4;

/**
 * GET /api/cron/tracking-digest
 *
 * Daily run (vercel.json: "0 6 * * *" — 06:00 UTC ≈ 14:00 Asia/Taipei).
 * MVP: iterates active tracking_lists due for refresh and runs each.
 * Digest composition/delivery is a follow-up phase.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: lists, error } = await db
    .from("tracking_lists")
    .select(
      "id, line_user_id, group_id, source_type, source_url, display_name, category, keywords, region, is_active, frequency_hours, last_run_at, last_success_at, consecutive_failures"
    )
    .eq("is_active", true)
    .or(`last_run_at.is.null,last_run_at.lt.${dueCutoff(nowIso)}`)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    captureError(error, { context: "cron_tracking_digest" });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!lists?.length) return NextResponse.json({ processed: 0 });

  const results = await runWithConcurrency(
    lists as TrackingList[],
    CONCURRENCY,
    (l) => runTrackingList(l)
  );

  const counts = results.reduce(
    (acc, r) => {
      if (r.status === "fulfilled") acc[r.value.status]++;
      else acc.failed++;
      return acc;
    },
    { success: 0, skipped: 0, failed: 0 }
  );

  console.info(`[cron/tracking-digest] processed ${lists.length}`, counts);
  return NextResponse.json({ processed: lists.length, ...counts });
}

// Lists whose last_run_at is older than their frequency are due. SQL-side
// comparison would need a computed column; doing the floor client-side for
// MVP keeps the query simple and is fine at current scale.
function dueCutoff(nowIso: string): string {
  // Conservative: anything older than 1h is considered potentially due; the
  // per-row frequency check happens inside runTrackingList via last_run_at
  // update — no work is duplicated because a `success` run resets the clock.
  return new Date(new Date(nowIso).getTime() - 60 * 60 * 1000).toISOString();
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
