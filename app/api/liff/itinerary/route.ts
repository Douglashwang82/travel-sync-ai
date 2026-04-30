import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTripMembership } from "@/lib/liff-server";
import { createAdminClient } from "@/lib/db";
import { TripItemMetadataSchema } from "@/lib/trip-item-metadata";
import {
  getConfirmedItems,
  createTripItem,
  updateBookingStatus,
  updateTripItemMetadata,
  deleteTripItem,
} from "@/services/trip-items";
import type { ApiError } from "@/lib/types";
import type { ItineraryRow } from "@/services/trip-items";

// Re-export so the UI page can import the shape from the route module.
export type { ItineraryRow as ItineraryItem };

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

// ─── GET /api/liff/itinerary?tripId=... ──────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const result = QuerySchema.safeParse({ tripId: searchParams.get("tripId") });

  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "tripId is required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  const db = createAdminClient();
  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) {
    return NextResponse.json<ApiError>(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  try {
    const items = await getConfirmedItems(tripId);
    return NextResponse.json({ trip, items });
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Failed to load itinerary", code: "DB_ERROR" },
      { status: 500 }
    );
  }
}

// ─── POST /api/liff/itinerary ─────────────────────────────────────────────────
// Manually add a confirmed trip item from LIFF (source = 'manual').

const CreateSchema = z.object({
  tripId: z.string().uuid(),
  item_type: z.enum(["hotel", "restaurant", "activity", "transport", "insurance", "flight", "other"]),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  deadline_at: z.string().datetime({ offset: true }).optional(),
  metadata: TripItemMetadataSchema.optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const result = CreateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: result.error.issues[0]?.message ?? "Invalid input", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId, item_type, title, description, deadline_at, metadata } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  try {
    const id = await createTripItem({
      tripId,
      itemType: item_type,
      title,
      description,
      deadlineAt: deadline_at,
      metadata,
      addedByLineUserId: membership.lineUserId,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Failed to create item", code: "DB_ERROR" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/liff/itinerary ────────────────────────────────────────────────
// Update booking status or metadata on an existing item.

const PatchSchema = z.object({
  tripId: z.string().uuid(),
  itemId: z.string().uuid(),
  action: z.enum(["booking", "metadata"]),
  // action = "booking"
  booking_status: z.enum(["not_required", "needed", "booked"]).optional(),
  booking_ref: z.string().max(200).nullable().optional(),
  // action = "metadata"
  metadata: TripItemMetadataSchema.optional(),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const result = PatchSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: result.error.issues[0]?.message ?? "Invalid input", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId, itemId, action } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  try {
    if (action === "booking") {
      if (!result.data.booking_status) {
        return NextResponse.json<ApiError>(
          { error: "booking_status is required for action=booking", code: "VALIDATION_ERROR" },
          { status: 400 }
        );
      }
      await updateBookingStatus(
        itemId,
        result.data.booking_status,
        result.data.booking_ref ?? null,
        membership.lineUserId
      );
    } else {
      if (!result.data.metadata) {
        return NextResponse.json<ApiError>(
          { error: "metadata is required for action=metadata", code: "VALIDATION_ERROR" },
          { status: 400 }
        );
      }
      await updateTripItemMetadata(itemId, result.data.metadata);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Failed to update item", code: "DB_ERROR" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/liff/itinerary ───────────────────────────────────────────────
// Only manually-added items can be deleted; vote-decided items stay for audit.

const DeleteSchema = z.object({
  tripId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const result = DeleteSchema.safeParse({
    tripId: searchParams.get("tripId"),
    itemId: searchParams.get("itemId"),
  });

  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "tripId and itemId are required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId, itemId } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  try {
    const outcome = await deleteTripItem(itemId, tripId);
    if (!outcome.deleted) {
      const message =
        outcome.reason === "not_found"
          ? "Item not found"
          : "Only manually added items can be removed here. Use the board to reject vote-decided items.";
      return NextResponse.json<ApiError>(
        { error: message, code: "FORBIDDEN" },
        { status: outcome.reason === "not_found" ? 404 : 403 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Failed to delete item", code: "DB_ERROR" },
      { status: 500 }
    );
  }
}
