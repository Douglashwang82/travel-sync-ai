import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import { setPlanTaskDone } from "@/services/orchestrator";

type RouteContext = { params: Promise<{ tripId: string }> };

const PatchSchema = z.object({
  categoryId: z.string().min(1).max(80),
  taskId: z.string().min(1).max(80),
  done: z.boolean(),
});

/**
 * PATCH /api/app/trips/:tripId/orchestrator/plan
 *
 * User-driven toggle for a plan task's done state. Distinct from the LLM
 * `plan.toggle_task` tool: this writes straight to `trip_orchestrators.memory.plan`
 * without creating an orchestrator_action row.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: "INVALID" }, { status: 400 });
  }

  const result = await setPlanTaskDone(
    tripId,
    parsed.data.categoryId,
    parsed.data.taskId,
    parsed.data.done,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ plan: result.plan });
}
