import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

/**
 * Canvas layout is per (trip, app_user): every member arranges their own board
 * and it follows them across devices. `tiles` are absolute world-space
 * positions/sizes; `viewport` is the last pan/zoom so the board reopens where
 * it was left.
 */
const TileSchema = z.object({
  id: z.string().min(1).max(128),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1),
  h: z.number().finite().min(1),
});

const ViewportSchema = z.object({
  zoom: z.number().finite().positive(),
  panX: z.number().finite(),
  panY: z.number().finite(),
});

const PutSchema = z.object({
  tiles: z.array(TileSchema).max(256),
  viewport: ViewportSchema.optional(),
});

export type CanvasTileLayout = z.infer<typeof TileSchema>;
export type CanvasViewport = z.infer<typeof ViewportSchema>;
export interface CanvasLayout {
  tiles: CanvasTileLayout[];
  viewport: CanvasViewport | null;
}

/** GET /api/app/trips/:tripId/canvas-layout — the caller's saved board. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_canvas_layouts")
    .select("tiles, viewport")
    .eq("trip_id", tripId)
    .eq("app_user_id", auth.appUserId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load canvas layout", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const viewport = (data?.viewport ?? null) as CanvasViewport | Record<string, never> | null;
  const layout: CanvasLayout = {
    tiles: (data?.tiles as CanvasTileLayout[] | null) ?? [],
    viewport: viewport && "zoom" in viewport ? (viewport as CanvasViewport) : null,
  };
  return NextResponse.json({ layout });
}

/** PUT /api/app/trips/:tripId/canvas-layout — upsert the caller's board. */
export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { error } = await db
    .from("trip_canvas_layouts")
    .upsert(
      {
        trip_id: tripId,
        app_user_id: auth.appUserId,
        tiles: parsed.data.tiles,
        viewport: parsed.data.viewport ?? {},
      },
      { onConflict: "trip_id,app_user_id" },
    );

  if (error) {
    return NextResponse.json(
      { error: "Failed to save canvas layout", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
