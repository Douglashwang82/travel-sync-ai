import { after } from "next/server";
import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { runOrchestrator } from "./runner";
import { getTool } from "./tools";
import type { OrchestratorActionStatus, OrchestratorTrigger, ToolAutonomyMap, TripPlan } from "./types";
import type { AgentAutonomy } from "@/services/agents/types";

export { runOrchestrator } from "./runner";
export { listTools, getTool, listCustomGridAgents } from "./tools";
export type * from "./types";

const DEFAULT_SCHEDULE_MINUTES = 360;

interface OrchestratorRowFull {
  id: string;
  trip_id: string;
  enabled: boolean;
  system_goal: string | null;
  tool_autonomy: ToolAutonomyMap | null;
  schedule_minutes: number;
  memory: Record<string, unknown> | null;
  consecutive_failures: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_summary: string | null;
  last_error: string | null;
  pending_reason: string | null;
  pending_trigger: OrchestratorTrigger | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lazy-create the per-trip orchestrator row if it doesn't exist. Safe to call
 * from API routes on demand; subsequent calls are read-only.
 */
export async function ensureOrchestrator(tripId: string): Promise<OrchestratorRowFull> {
  const db = createAdminClient();
  const { data: existing } = await db
    .from("trip_orchestrators")
    .select("*")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (existing) return existing as unknown as OrchestratorRowFull;

  const { data, error } = await db
    .from("trip_orchestrators")
    .insert({
      trip_id: tripId,
      enabled: true,
      schedule_minutes: DEFAULT_SCHEDULE_MINUTES,
      next_run_at: new Date(Date.now() + 60_000).toISOString(), // first run in a minute
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create orchestrator: ${error?.message}`);
  }
  return data as unknown as OrchestratorRowFull;
}

export async function getOrchestrator(tripId: string): Promise<OrchestratorRowFull | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_orchestrators")
    .select("*")
    .eq("trip_id", tripId)
    .maybeSingle();
  return (data as OrchestratorRowFull | null) ?? null;
}

/**
 * Hybrid trigger entry point. Called from the LINE event-processor and from
 * mutation paths (item created, vote closed, expense added, …) to nudge the
 * orchestrator into running ASAP.
 *
 * Mechanics: set `next_run_at = now()` and fire the runner via Next.js
 * `after()` so the user-facing request returns immediately. The cron sweeper
 * is the fallback if `after()` crashes or the cold-start can't reach Gemini.
 */
export async function wakeOrchestrator(tripId: string, reason: string): Promise<void> {
  let orch: OrchestratorRowFull;
  try {
    orch = await ensureOrchestrator(tripId);
  } catch (err) {
    captureError(err, { context: "wakeOrchestrator.ensure", tripId, reason });
    return;
  }
  if (!orch.enabled) return;

  const db = createAdminClient();
  await db
    .from("trip_orchestrators")
    .update({
      next_run_at: new Date().toISOString(),
      pending_reason: reason,
      pending_trigger: "event",
    })
    .eq("id", orch.id);

  after(async () => {
    try {
      await runOrchestrator(
        {
          id: orch.id,
          trip_id: orch.trip_id,
          enabled: orch.enabled,
          system_goal: orch.system_goal,
          tool_autonomy: orch.tool_autonomy,
          schedule_minutes: orch.schedule_minutes,
          memory: orch.memory,
          consecutive_failures: orch.consecutive_failures,
        },
        "event",
        reason,
      );
    } catch (err) {
      captureError(err, { context: "wakeOrchestrator.run", tripId, reason });
    }
  });
}

export interface UpdateOrchestratorInput {
  enabled?: boolean;
  systemGoal?: string | null;
  scheduleMinutes?: number;
  toolAutonomy?: ToolAutonomyMap;
}

export async function updateOrchestrator(
  tripId: string,
  patch: UpdateOrchestratorInput,
): Promise<OrchestratorRowFull> {
  const orch = await ensureOrchestrator(tripId);
  const db = createAdminClient();
  const update: Record<string, unknown> = {};
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.systemGoal !== undefined) update.system_goal = patch.systemGoal;
  if (patch.scheduleMinutes !== undefined) update.schedule_minutes = patch.scheduleMinutes;
  if (patch.toolAutonomy !== undefined) update.tool_autonomy = patch.toolAutonomy;
  if (Object.keys(update).length === 0) return orch;
  const { data, error } = await db
    .from("trip_orchestrators")
    .update(update)
    .eq("id", orch.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to update orchestrator: ${error?.message}`);
  return data as unknown as OrchestratorRowFull;
}

// ─── plan: user-driven task toggle ──────────────────────────────────────────

/**
 * User-facing toggle for a plan task. Different from `plan.toggle_task` (the
 * LLM tool) — this is the direct path used by the Orchestrator-mode UI when a
 * member checks/unchecks a box. Does not create an orchestrator_action row.
 */
export async function setPlanTaskDone(
  tripId: string,
  categoryId: string,
  taskId: string,
  done: boolean,
): Promise<{ ok: true; plan: TripPlan } | { ok: false; error: string }> {
  const orch = await ensureOrchestrator(tripId);
  const plan = (orch.memory as { plan?: TripPlan } | null)?.plan;
  if (!plan) return { ok: false, error: "No plan to update" };

  let touched = false;
  const next: TripPlan = {
    ...plan,
    categories: plan.categories.map((c) =>
      c.id !== categoryId
        ? c
        : {
            ...c,
            tasks: c.tasks.map((t) => {
              if (t.id !== taskId) return t;
              touched = true;
              return { ...t, done };
            }),
          },
    ),
  };
  if (!touched) return { ok: false, error: "Task not found" };

  const db = createAdminClient();
  const nextMemory = { ...(orch.memory ?? {}), plan: next };
  const { error } = await db
    .from("trip_orchestrators")
    .update({ memory: nextMemory })
    .eq("id", orch.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, plan: next };
}

// ─── action lane: confirm / dismiss / undo ──────────────────────────────────

export interface OrchestratorActionRow {
  id: string;
  orchestrator_id: string;
  run_id: string | null;
  trip_id: string;
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  rationale: string | null;
  status: OrchestratorActionStatus;
  autonomy: AgentAutonomy;
  target: { table: string; id: string; op: "insert" | "update" | "delete"; before?: Record<string, unknown> | null } | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export async function listRecentActions(
  tripId: string,
  limit = 30,
): Promise<OrchestratorActionRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("orchestrator_actions")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as OrchestratorActionRow[];
}

/**
 * Promote a pending proposal to an applied action by executing the tool
 * exactly as the LLM specified.
 */
export async function confirmAction(
  actionId: string,
  appUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { data: action } = await db
    .from("orchestrator_actions")
    .select("*")
    .eq("id", actionId)
    .single();
  if (!action) return { ok: false, error: "Action not found" };
  if (action.status !== "pending") return { ok: false, error: `Action is ${action.status}` };

  const tool = getTool(action.tool as string);
  if (!tool) return { ok: false, error: `Unknown tool: ${action.tool}` };

  const parsed = tool.args.safeParse(action.input);
  if (!parsed.success) return { ok: false, error: `Invalid stored args: ${parsed.error.message}` };

  try {
    const result = await tool.execute(
      {
        tripId: action.trip_id as string,
        orchestratorId: action.orchestrator_id as string,
        actorKey: "orchestrator",
      },
      parsed.data,
    );
    await db
      .from("orchestrator_actions")
      .update({
        status: "applied",
        result: (result.data ?? null) as Record<string, unknown> | null,
        target: result.target ?? null,
        rationale: result.summary,
        decided_by: appUserId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .from("orchestrator_actions")
      .update({
        status: "failed",
        rationale: `Confirm failed: ${msg}`,
        decided_by: appUserId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    return { ok: false, error: msg };
  }
}

export async function dismissAction(
  actionId: string,
  appUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orchestrator_actions")
    .update({
      status: "dismissed",
      decided_by: appUserId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("status", "pending")
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Action not pending" };
  return { ok: true };
}

/**
 * Undo an applied action by reversing its target. Best-effort: for inserts we
 * delete the row; for updates we restore `before`; for deletes we can't
 * recreate referenced rows so we only restore plain columns on a re-insert.
 */
export async function undoAction(
  actionId: string,
  appUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { data: action } = await db
    .from("orchestrator_actions")
    .select("*")
    .eq("id", actionId)
    .single();
  if (!action) return { ok: false, error: "Action not found" };
  if (action.status !== "applied") {
    return { ok: false, error: `Cannot undo: status is ${action.status}` };
  }
  const target = action.target as OrchestratorActionRow["target"];
  if (!target) return { ok: false, error: "Action has no undo target" };

  try {
    if (target.op === "insert") {
      const { error } = await db.from(target.table).delete().eq("id", target.id);
      if (error) throw new Error(error.message);
    } else if (target.op === "update" && target.before) {
      const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = target.before as Record<string, unknown>;
      void _id; void _ca; void _ua;
      const { error } = await db.from(target.table).update(rest).eq("id", target.id);
      if (error) throw new Error(error.message);
    } else if (target.op === "delete" && target.before) {
      const { error } = await db.from(target.table).insert(target.before);
      if (error) throw new Error(error.message);
    } else {
      return { ok: false, error: "No reversible information stored" };
    }

    await db
      .from("orchestrator_actions")
      .update({
        status: "undone",
        decided_by: appUserId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
