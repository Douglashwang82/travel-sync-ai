import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { getAgent } from "./registry";

import type { AgentAutonomy } from "./types";

export interface CustomGridRow {
  id: string;
  trip_id: string;
  agent_type: string;
  config: unknown;
  frequency_hours: number;
  consecutive_failures: number;
  autonomy: AgentAutonomy;
}

export type RunOutcome =
  | { status: "success"; runId: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string };

const MAX_BACKOFF_HOURS = 24;

/**
 * Execute one custom grid: marks it `running`, dispatches to the agent
 * registry, persists the result onto both `custom_grid_runs` (history)
 * and the parent `custom_grids` row (latest snapshot for fast UI render).
 *
 * Failures bump `consecutive_failures` and push `next_run_at` forward with
 * exponential backoff capped at MAX_BACKOFF_HOURS.
 */
export async function runCustomGrid(grid: CustomGridRow): Promise<RunOutcome> {
  const agent = getAgent(grid.agent_type);
  if (!agent) {
    const msg = `Unknown agent_type: ${grid.agent_type}`;
    await markFailure(grid, msg);
    return { status: "failed", error: msg };
  }

  const db = createAdminClient();
  const startedAt = new Date();

  const { data: runRow, error: insertErr } = await db
    .from("custom_grid_runs")
    .insert({
      custom_grid_id: grid.id,
      status: "running",
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    captureError(insertErr ?? new Error("Failed to insert run row"), {
      context: "custom_grid_runner",
      custom_grid_id: grid.id,
    });
    return { status: "failed", error: "Failed to record run start" };
  }

  const runId = runRow.id as string;

  try {
    const result = await agent.run({
      tripId: grid.trip_id,
      customGridId: grid.id,
      config: grid.config,
      autonomy: grid.autonomy,
    });
    const finishedAt = new Date();

    await db
      .from("custom_grid_runs")
      .update({
        status: "success",
        output: result.output,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .eq("id", runId);

    await db
      .from("custom_grids")
      .update({
        last_run_at: finishedAt.toISOString(),
        next_run_at: addHours(finishedAt, grid.frequency_hours).toISOString(),
        last_status: "success",
        last_output: result.output,
        last_error: null,
        consecutive_failures: 0,
      })
      .eq("id", grid.id);

    return { status: "success", runId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    captureError(err, { context: "custom_grid_runner", custom_grid_id: grid.id });

    await db
      .from("custom_grid_runs")
      .update({
        status: "failed",
        error: errMsg,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .eq("id", runId);

    await markFailure(grid, errMsg);
    return { status: "failed", error: errMsg };
  }
}

async function markFailure(grid: CustomGridRow, error: string): Promise<void> {
  const db = createAdminClient();
  const nextFailures = grid.consecutive_failures + 1;
  const backoffHours = Math.min(
    grid.frequency_hours * Math.pow(2, nextFailures - 1),
    MAX_BACKOFF_HOURS,
  );
  await db
    .from("custom_grids")
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: addHours(new Date(), backoffHours).toISOString(),
      last_status: "failed",
      last_error: error,
      consecutive_failures: nextFailures,
    })
    .eq("id", grid.id);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
