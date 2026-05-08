import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppOrganizer } from "@/lib/app-server";
import { addOption } from "@/services/trip-state";

type RouteContext = { params: Promise<{ tripId: string; itemId: string }> };

const BodySchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional(),
  imageUrl: z.string().url().max(1000).optional(),
  bookingUrl: z.string().url().max(1000).optional(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
  googleMapsUrl: z.string().url().max(1000).optional(),
});

/**
 * POST /api/app/trips/:tripId/items/:itemId/options
 *
 * Organizer-only. Appends a new option to an existing decision item (todo or
 * pending stage). Rejects duplicate names.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, itemId } = await ctx.params;
  const auth = await requireAppOrganizer(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("trip_id")
    .eq("id", itemId)
    .single();
  if (!item || item.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Item not found in this trip", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const result = await addOption({ itemId, name: parsed.data.name.trim() });
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND"
        ? 404
        : result.code === "DUPLICATE"
          ? 409
          : 400;
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status }
    );
  }

  // If the caller supplied extra metadata (address, image, booking URL, geo),
  // patch it onto the just-inserted option row.
  const hasExtras =
    parsed.data.address ||
    parsed.data.imageUrl ||
    parsed.data.bookingUrl ||
    parsed.data.lat != null ||
    parsed.data.lng != null ||
    parsed.data.googleMapsUrl;
  if (hasExtras) {
    const patch: Record<string, unknown> = {};
    if (parsed.data.address) patch.address = parsed.data.address.trim();
    if (parsed.data.imageUrl) patch.image_url = parsed.data.imageUrl;
    if (parsed.data.bookingUrl) patch.booking_url = parsed.data.bookingUrl;
    if (parsed.data.lat != null) patch.lat = parsed.data.lat;
    if (parsed.data.lng != null) patch.lng = parsed.data.lng;
    if (parsed.data.googleMapsUrl) patch.google_maps_url = parsed.data.googleMapsUrl;
    await db.from("trip_item_options").update(patch).eq("id", result.optionId);
  }

  const { data: option } = await db
    .from("trip_item_options")
    .select("id, name, address, image_url, booking_url, lat, lng, google_maps_url")
    .eq("id", result.optionId)
    .single();

  return NextResponse.json({ option }, { status: 201 });
}
