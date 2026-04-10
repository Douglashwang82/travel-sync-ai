import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

export interface ItineraryItem {
  id: string;
  title: string;
  item_type: string;
  deadline_at: string | null;
  confirmed_option: {
    id: string;
    name: string;
    address: string | null;
    image_url: string | null;
    rating: number | null;
    price_level: string | null;
    booking_url: string | null;
  } | null;
}

/**
 * GET /api/liff/itinerary?tripId=...
 *
 * Returns confirmed items ordered by deadline_at (nulls last), with their
 * confirmed option details for the itinerary timeline view.
 */
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

  const { data: items, error: itemsError } = await db
    .from("trip_items")
    .select(`
      id,
      title,
      item_type,
      deadline_at,
      confirmed_option_id,
      trip_item_options!trip_items_confirmed_option_id_fkey (
        id,
        name,
        address,
        image_url,
        rating,
        price_level,
        booking_url
      )
    `)
    .eq("trip_id", tripId)
    .eq("stage", "confirmed")
    .order("deadline_at", { ascending: true, nullsFirst: false });

  if (itemsError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load itinerary", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const itinerary: ItineraryItem[] = (items ?? []).map((item) => {
    const opt = Array.isArray(item.trip_item_options)
      ? item.trip_item_options[0]
      : item.trip_item_options;
    return {
      id: item.id,
      title: item.title,
      item_type: item.item_type,
      deadline_at: item.deadline_at,
      confirmed_option: opt
        ? {
            id: opt.id,
            name: opt.name,
            address: opt.address,
            image_url: opt.image_url,
            rating: opt.rating,
            price_level: opt.price_level,
            booking_url: opt.booking_url,
          }
        : null,
    };
  });

  return NextResponse.json({ trip, items: itinerary });
}
