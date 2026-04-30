import { createAdminClient } from "@/lib/db";
import {
  TripItemMetadataSchema,
  emptyMetadata,
  type TripItemMetadata,
} from "@/lib/trip-item-metadata";
import type { BookingStatus, ItemSource, ItemType } from "@/lib/types";

// ─── Read ─────────────────────────────────────────────────────────────────────

export interface ItineraryRow {
  id: string;
  title: string;
  item_type: ItemType;
  stage: string;
  source: ItemSource;
  deadline_at: string | null;
  booking_status: BookingStatus;
  booking_ref: string | null;
  metadata: TripItemMetadata;
  confirmed_option: {
    id: string;
    name: string;
    address: string | null;
    image_url: string | null;
    rating: number | null;
    price_level: string | null;
    booking_url: string | null;
    google_maps_url: string | null;
  } | null;
}

export async function getConfirmedItems(tripId: string): Promise<ItineraryRow[]> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("trip_items")
    .select(`
      id,
      title,
      item_type,
      stage,
      source,
      deadline_at,
      booking_status,
      booking_ref,
      metadata,
      trip_item_options!trip_items_confirmed_option_id_fkey (
        id,
        name,
        address,
        image_url,
        rating,
        price_level,
        booking_url,
        google_maps_url
      )
    `)
    .eq("trip_id", tripId)
    .eq("stage", "confirmed")
    .order("deadline_at", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to load trip items: ${error.message}`);

  return (data ?? []).map((row) => {
    const opt = Array.isArray(row.trip_item_options)
      ? row.trip_item_options[0]
      : row.trip_item_options;

    return {
      id: row.id,
      title: row.title,
      item_type: row.item_type as ItemType,
      stage: row.stage,
      source: row.source as ItemSource,
      deadline_at: row.deadline_at,
      booking_status: (row.booking_status ?? "not_required") as BookingStatus,
      booking_ref: row.booking_ref ?? null,
      metadata: parseMetadata(row.metadata, row.item_type as ItemType),
      confirmed_option: opt
        ? {
            id: opt.id,
            name: opt.name,
            address: opt.address ?? null,
            image_url: opt.image_url ?? null,
            rating: opt.rating ?? null,
            price_level: opt.price_level ?? null,
            booking_url: opt.booking_url ?? null,
            google_maps_url: opt.google_maps_url ?? null,
          }
        : null,
    };
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateTripItemInput {
  tripId: string;
  itemType: ItemType;
  title: string;
  description?: string;
  deadlineAt?: string;
  metadata?: TripItemMetadata;
  addedByLineUserId: string;
}

export async function createTripItem(input: CreateTripItemInput): Promise<string> {
  const db = createAdminClient();
  const metadata = input.metadata ?? emptyMetadata(input.itemType);

  const { data, error } = await db
    .from("trip_items")
    .insert({
      trip_id: input.tripId,
      item_type: input.itemType,
      item_kind: "decision",
      title: input.title,
      description: input.description ?? null,
      stage: "confirmed",
      source: "manual",
      booking_status: requiresBooking(input.itemType) ? "needed" : "not_required",
      deadline_at: input.deadlineAt ?? null,
      metadata,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create trip item: ${error.message}`);
  return data.id;
}

// ─── Update booking lifecycle ─────────────────────────────────────────────────

export async function updateBookingStatus(
  itemId: string,
  bookingStatus: BookingStatus,
  bookingRef: string | null,
  bookedByLineUserId: string
): Promise<void> {
  const db = createAdminClient();

  const patch: Record<string, unknown> = {
    booking_status: bookingStatus,
    booking_ref: bookingRef,
  };

  if (bookingStatus === "booked") {
    patch.booked_by_line_user_id = bookedByLineUserId;
    patch.booked_at = new Date().toISOString();
  }

  const { error } = await db
    .from("trip_items")
    .update(patch)
    .eq("id", itemId);

  if (error) throw new Error(`Failed to update booking status: ${error.message}`);
}

// ─── Update metadata ──────────────────────────────────────────────────────────

export async function updateTripItemMetadata(
  itemId: string,
  metadata: TripItemMetadata
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("trip_items")
    .update({ metadata, deadline_at: extractDeadlineFromMetadata(metadata) })
    .eq("id", itemId);

  if (error) throw new Error(`Failed to update trip item metadata: ${error.message}`);
}

// ─── Delete (manual-source items only) ───────────────────────────────────────

export async function deleteTripItem(
  itemId: string,
  tripId: string
): Promise<{ deleted: boolean; reason?: string }> {
  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, source")
    .eq("id", itemId)
    .eq("trip_id", tripId)
    .single();

  if (!item) return { deleted: false, reason: "not_found" };

  // Only manually-added items can be deleted from LIFF; vote-decided items
  // must be rejected on the board to preserve audit trail.
  if (item.source !== "manual") {
    return { deleted: false, reason: "not_manual" };
  }

  const { error } = await db.from("trip_items").delete().eq("id", itemId);
  if (error) throw new Error(`Failed to delete trip item: ${error.message}`);
  return { deleted: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requiresBooking(type: ItemType): boolean {
  return ["hotel", "restaurant", "activity", "transport", "flight"].includes(type);
}

function parseMetadata(raw: unknown, itemType: ItemType): TripItemMetadata {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const withType = { type: itemType, ...(raw as Record<string, unknown>) };
    const parsed = TripItemMetadataSchema.safeParse(withType);
    if (parsed.success) return parsed.data;
  }
  return emptyMetadata(itemType);
}

function extractDeadlineFromMetadata(metadata: TripItemMetadata): string | null {
  if (metadata.type === "flight" && metadata.departure_time) {
    return metadata.departure_time;
  }
  if (metadata.type === "restaurant" && metadata.reservation_time) {
    return metadata.reservation_time;
  }
  return null;
}
