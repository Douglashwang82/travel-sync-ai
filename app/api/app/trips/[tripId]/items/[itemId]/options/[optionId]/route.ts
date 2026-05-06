import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = {
  params: Promise<{ tripId: string; itemId: string; optionId: string }>;
};

const PatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(400).nullable().optional(),
    imageUrl: z.string().url().max(1000).nullable().optional(),
    bookingUrl: z.string().url().max(1000).nullable().optional(),
    googleMapsUrl: z.string().url().max(1000).nullable().optional(),
    priceLevel: z.string().max(40).nullable().optional(),
    rating: z.number().min(0).max(5).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export interface OptionDetailResponse {
  option: {
    id: string;
    name: string;
    address: string | null;
    imageUrl: string | null;
    bookingUrl: string | null;
    googleMapsUrl: string | null;
    priceLevel: string | null;
    rating: number | null;
    notes: string | null;
    notesUpdatedAt: string | null;
    notesUpdatedBy: string | null;
    notesUpdatedByName: string | null;
  };
}

/**
 * PATCH /api/app/trips/:tripId/items/:itemId/options/:optionId
 *
 * Any group member can enrich an option with price, experience notes,
 * location, etc. Used by the option detail dialog so the whole group can
 * collaborate on a decision instead of relying on the organizer alone.
 *
 * `notes` is stored on metadata_json so existing schema continues to work.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId, itemId, optionId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  // Verify the option belongs to this item, and the item to this trip.
  const { data: option } = await db
    .from("trip_item_options")
    .select("id, trip_item_id, metadata_json, trip_items!inner(trip_id)")
    .eq("id", optionId)
    .single();

  const optionItemId =
    (option?.trip_item_id as string | undefined) ?? null;
  const linkedTripId =
    (
      option?.trip_items as
        | { trip_id: string }
        | { trip_id: string }[]
        | undefined
    )
      ? Array.isArray(option!.trip_items)
        ? (option!.trip_items[0]?.trip_id as string | undefined)
        : ((option!.trip_items as { trip_id: string }).trip_id as
            | string
            | undefined)
      : undefined;

  if (!option || optionItemId !== itemId || linkedTripId !== tripId) {
    return NextResponse.json(
      { error: "Option not found in this item", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.address !== undefined)
    patch.address =
      parsed.data.address === null ? null : parsed.data.address.trim();
  if (parsed.data.imageUrl !== undefined) patch.image_url = parsed.data.imageUrl;
  if (parsed.data.bookingUrl !== undefined)
    patch.booking_url = parsed.data.bookingUrl;
  if (parsed.data.googleMapsUrl !== undefined)
    patch.google_maps_url = parsed.data.googleMapsUrl;
  if (parsed.data.priceLevel !== undefined)
    patch.price_level =
      parsed.data.priceLevel === null
        ? null
        : parsed.data.priceLevel.trim() || null;
  if (parsed.data.rating !== undefined) patch.rating = parsed.data.rating;

  if (parsed.data.notes !== undefined) {
    const meta =
      (option.metadata_json as Record<string, unknown> | null) ?? {};
    const trimmed =
      parsed.data.notes === null ? null : parsed.data.notes.trim() || null;
    const nextMeta: Record<string, unknown> = { ...meta };
    if (trimmed === null) {
      delete nextMeta.notes;
      delete nextMeta.notesUpdatedAt;
      delete nextMeta.notesUpdatedBy;
    } else {
      nextMeta.notes = trimmed;
      nextMeta.notesUpdatedAt = new Date().toISOString();
      nextMeta.notesUpdatedBy = auth.lineUserId;
    }
    patch.metadata_json = nextMeta;
  }

  const { data: updated, error } = await db
    .from("trip_item_options")
    .update(patch)
    .eq("id", optionId)
    .select(
      "id, name, address, image_url, booking_url, google_maps_url, price_level, rating, metadata_json"
    )
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: "Failed to update option", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  // Resolve display name for whoever last updated the notes.
  const meta =
    (updated.metadata_json as Record<string, unknown> | null) ?? {};
  const updatedBy = (meta.notesUpdatedBy as string | undefined) ?? null;
  let updatedByName: string | null = null;
  if (updatedBy) {
    const { data: member } = await db
      .from("group_members")
      .select("display_name")
      .eq("group_id", auth.groupId)
      .eq("line_user_id", updatedBy)
      .is("left_at", null)
      .single();
    updatedByName = (member?.display_name as string | null) ?? null;
  }

  return NextResponse.json<OptionDetailResponse>({
    option: {
      id: updated.id as string,
      name: updated.name as string,
      address: (updated.address as string | null) ?? null,
      imageUrl: (updated.image_url as string | null) ?? null,
      bookingUrl: (updated.booking_url as string | null) ?? null,
      googleMapsUrl: (updated.google_maps_url as string | null) ?? null,
      priceLevel: (updated.price_level as string | null) ?? null,
      rating: updated.rating != null ? Number(updated.rating) : null,
      notes: (meta.notes as string | null | undefined) ?? null,
      notesUpdatedAt: (meta.notesUpdatedAt as string | null | undefined) ?? null,
      notesUpdatedBy: updatedBy,
      notesUpdatedByName: updatedByName,
    },
  });
}
