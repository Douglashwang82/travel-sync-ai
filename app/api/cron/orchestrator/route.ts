import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/monitoring";
import { runOrchestrator } from "@/services/orchestrator";

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

/**
 * GET /api/cron/orchestrator
 *
 * Heartbeat + recovery for per-trip orchestrators. Picks every enabled
 * orchestrator whose `next_run_at` has elapsed (or is null) and runs it.
 * Hybrid model: webhook + mutations may already have nudged via
 * `wakeOrchestrator`; this sweeper covers the cold-path.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: orchs, error } = await db
    .from("trip_orchestrators")
    .select("id, trip_id, enabled, system_goal, tool_autonomy, schedule_minutes, memory, consecutive_failures, pending_trigger, pending_reason")
    .eq("enabled", true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    captureError(error, { context: "cron_orchestrator" });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!orchs?.length) return NextResponse.json({ processed: 0 });

  const results = await runWithConcurrency(orchs, CONCURRENCY, (o) =>
    runOrchestrator(
      {
        id: o.id as string,
        trip_id: o.trip_id as string,
        enabled: o.enabled as boolean,
        system_goal: (o.system_goal as string | null) ?? null,
        tool_autonomy: (o.tool_autonomy as Record<string, "propose_only" | "auto_apply_with_undo" | "auto_apply"> | null) ?? null,
        schedule_minutes: o.schedule_minutes as number,
        memory: (o.memory as Record<string, unknown> | null) ?? null,
        consecutive_failures: o.consecutive_failures as number,
      },
      (o.pending_trigger as "cron" | "event" | "manual" | null) ?? "cron",
      (o.pending_reason as string | null) ?? undefined,
    ),
  );

  const counts = results.reduce(
    (acc, r) => {
      if (r.status === "fulfilled") {
        if (r.value.status === "success") acc.success++;
        else acc.failed++;
      } else acc.failed++;
      return acc;
    },
    { success: 0, failed: 0 },
  );

  console.info(`[cron/orchestrator] processed ${orchs.length}`, counts);
  return NextResponse.json({ processed: orchs.length, ...counts });
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
