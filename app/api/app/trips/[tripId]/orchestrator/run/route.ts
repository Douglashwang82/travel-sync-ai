import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import { ensureOrchestrator, runOrchestrator } from "@/services/orchestrator";

type RouteContext = { params: Promise<{ tripId: string }> };

const BodySchema = z
  .object({ reason: z.string().max(400).optional() })
  .default({ reason: undefined });

/**
 * POST /api/app/trips/:tripId/orchestrator/run
 *
 * Manual nudge. Triggers a synchronous run and returns the summary. The
 * runner persists its own audit row, so the caller only needs the result for
 * the UI's optimistic update.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: "INVALID" }, { status: 400 });
  }

  const orch = await ensureOrchestrator(tripId);
  if (!orch.enabled) {
    return NextResponse.json({ error: "Orchestrator is disabled", code: "DISABLED" }, { status: 400 });
  }

  const result = await runOrchestrator(
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
    "manual",
    parsed.data.reason,
  );

  return NextResponse.json({ result });
}
