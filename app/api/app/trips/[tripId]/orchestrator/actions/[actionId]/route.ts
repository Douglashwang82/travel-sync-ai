import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import { confirmAction, dismissAction, undoAction } from "@/services/orchestrator";

type RouteContext = { params: Promise<{ tripId: string; actionId: string }> };

const BodySchema = z.object({
  decision: z.enum(["confirm", "dismiss", "undo"]),
});

/**
 * POST /api/app/trips/:tripId/orchestrator/actions/:actionId
 * Body: { decision: "confirm" | "dismiss" | "undo" }
 *
 * Single endpoint for the three ghost-lane decisions. We funnel them through
 * the same route to keep the tile UI's call surface small.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, actionId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: "INVALID" }, { status: 400 });
  }

  let result: { ok: boolean; error?: string };
  switch (parsed.data.decision) {
    case "confirm":
      result = await confirmAction(actionId, auth.appUserId);
      break;
    case "dismiss":
      result = await dismissAction(actionId, auth.appUserId);
      break;
    case "undo":
      result = await undoAction(actionId, auth.appUserId);
      break;
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: "DECISION_FAILED" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
