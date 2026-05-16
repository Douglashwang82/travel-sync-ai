import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const PatchSchema = z.object({
  autonomy: z.enum(["propose_only", "auto_apply_with_undo", "auto_apply"]).optional(),
});

/**
 * PATCH /api/app/trips/:tripId/custom-grids/:gridId — update mutable fields.
 * Only `autonomy` is patchable today; config/frequency stay write-once via
 * the create dialog to keep the surface small.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, gridId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.autonomy) patch.autonomy = parsed.data.autonomy;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const db = createAdminClient();
  const { error } = await db
    .from("custom_grids")
    .update(patch)
    .eq("id", gridId)
    .eq("trip_id", tripId);

  if (error) {
    return NextResponse.json({ error: "Failed to update", code: "DB_ERROR" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
