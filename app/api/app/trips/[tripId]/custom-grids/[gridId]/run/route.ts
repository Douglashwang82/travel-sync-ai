import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { runCustomGrid, type CustomGridRow } from "@/services/agents/runner";
import { rowToGrid } from "@/app/api/app/trips/[tripId]/custom-grids/route";

type RouteContext = { params: Promise<{ tripId: string; gridId: string }> };

/**
 * POST /api/app/trips/:tripId/custom-grids/:gridId/run
 *
 * Triggers the agent immediately. Same code path as the cron — useful for
 * the "Run now" button on the grid and to populate output right after the
 * grid is created.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, gridId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("custom_grids")
    .select("id, trip_id, agent_type, config, frequency_hours, consecutive_failures")
    .eq("id", gridId)
    .eq("trip_id", tripId)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Grid not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const outcome = await runCustomGrid(data as unknown as CustomGridRow);

  if (outcome.status === "failed") {
    return NextResponse.json(
      { error: outcome.error, code: "AGENT_RUN_FAILED" },
      { status: 500 },
    );
  }

  const { data: updated } = await db
    .from("custom_grids")
    .select(
      "id, trip_id, agent_type, title, config, is_active, frequency_hours, next_run_at, last_run_at, last_status, last_output, last_error, created_at",
    )
    .eq("id", gridId)
    .single();

  return NextResponse.json({ grid: updated ? rowToGrid(updated as Record<string, unknown>) : null, outcome });
}
