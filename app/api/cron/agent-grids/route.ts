import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/monitoring";
import { runCustomGrid, type CustomGridRow } from "@/services/agents/runner";

const BATCH_SIZE = 30;
const CONCURRENCY = 3;

/**
 * GET /api/cron/agent-grids
 *
 * Picks up every active `custom_grids` row whose `next_run_at` is null or has
 * elapsed, and dispatches each to its registered agent. Mirrors the pattern
 * used by tracking-digest, minus the digest fan-out (custom grids surface
 * their output via the bento UI, not LINE).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: grids, error } = await db
    .from("custom_grids")
    .select("id, trip_id, agent_type, config, frequency_hours, consecutive_failures")
    .eq("is_active", true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    captureError(error, { context: "cron_agent_grids" });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!grids?.length) return NextResponse.json({ processed: 0 });

  const results = await runWithConcurrency(
    grids as unknown as CustomGridRow[],
    CONCURRENCY,
    (g) => runCustomGrid(g),
  );

  const counts = results.reduce(
    (acc, r) => {
      if (r.status === "fulfilled") {
        if (r.value.status === "success") acc.success++;
        else if (r.value.status === "skipped") acc.skipped++;
        else acc.failed++;
      } else acc.failed++;
      return acc;
    },
    { success: 0, skipped: 0, failed: 0 },
  );

  console.info(`[cron/agent-grids] processed ${grids.length}`, counts);
  return NextResponse.json({ processed: grids.length, ...counts });
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]!) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
