import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import {
  ensureOrchestrator,
  updateOrchestrator,
  listRecentActions,
  listTools,
  listCustomGridAgents,
  type ToolAutonomyMap,
} from "@/services/orchestrator";

type RouteContext = { params: Promise<{ tripId: string }> };

const AutonomyEnum = z.enum(["propose_only", "auto_apply_with_undo", "auto_apply"]);

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  systemGoal: z.string().max(2000).nullable().optional(),
  scheduleMinutes: z.number().int().min(15).max(60 * 24 * 7).optional(),
  toolAutonomy: z.record(z.string(), AutonomyEnum).optional(),
});

/** GET /api/app/trips/:tripId/orchestrator — full tile state. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const [orch, actions] = await Promise.all([
    ensureOrchestrator(tripId),
    listRecentActions(tripId, 40),
  ]);

  const tools = listTools().map((t) => ({
    name: t.name,
    description: t.description,
    grid: t.grid,
    defaultAutonomy: t.defaultAutonomy,
  }));

  return NextResponse.json({
    orchestrator: {
      id: orch.id,
      enabled: orch.enabled,
      systemGoal: orch.system_goal,
      scheduleMinutes: orch.schedule_minutes,
      toolAutonomy: (orch.tool_autonomy ?? {}) as ToolAutonomyMap,
      nextRunAt: orch.next_run_at,
      lastRunAt: orch.last_run_at,
      lastStatus: orch.last_status,
      lastSummary: orch.last_summary,
      lastError: orch.last_error,
      pendingReason: orch.pending_reason,
      consecutiveFailures: orch.consecutive_failures,
    },
    tools,
    agents: listCustomGridAgents(),
    actions: actions.map(serializeAction),
  });
}

/** PATCH /api/app/trips/:tripId/orchestrator — update goal, autonomy, schedule. */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: "INVALID" }, { status: 400 });
  }

  // Reject autonomy keys that aren't real tools.
  if (parsed.data.toolAutonomy) {
    const known = new Set(listTools().map((t) => t.name));
    for (const k of Object.keys(parsed.data.toolAutonomy)) {
      if (!known.has(k)) {
        return NextResponse.json(
          { error: `Unknown tool: ${k}`, code: "INVALID" },
          { status: 400 },
        );
      }
    }
  }

  const orch = await updateOrchestrator(tripId, parsed.data);
  return NextResponse.json({
    orchestrator: {
      id: orch.id,
      enabled: orch.enabled,
      systemGoal: orch.system_goal,
      scheduleMinutes: orch.schedule_minutes,
      toolAutonomy: (orch.tool_autonomy ?? {}) as ToolAutonomyMap,
    },
  });
}

function serializeAction(a: Awaited<ReturnType<typeof listRecentActions>>[number]) {
  return {
    id: a.id,
    tool: a.tool,
    input: a.input,
    result: a.result,
    rationale: a.rationale,
    status: a.status,
    autonomy: a.autonomy,
    createdAt: a.created_at,
    decidedAt: a.decided_at,
  };
}
