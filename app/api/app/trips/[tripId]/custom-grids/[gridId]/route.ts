import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string; gridId: string }> };

/** DELETE /api/app/trips/:tripId/custom-grids/:gridId — remove a custom grid. */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, gridId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { error } = await db
    .from("custom_grids")
    .delete()
    .eq("id", gridId)
    .eq("trip_id", tripId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete grid", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
