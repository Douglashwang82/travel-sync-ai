import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface ItineraryOption {
  id: string;
  name: string;
  address: string | null;
  image_url: string | null;
  rating: number | null;
  price_level: string | null;
  booking_url: string | null;
  google_maps_url: string | null;
  lat: number | null;
  lng: number | null;
}

export interface ItineraryEntry {
  id: string;
  title: string;
  item_type: string;
  description: string | null;
  stage: string;
  deadline_at: string | null;
  assigned_to_line_user_id: string | null;
  booking_status: string;
  booking_ref: string | null;
  confirmed_option: ItineraryOption | null;
}

export interface ItineraryResponse {
  trip: {
    id: string;
    destination_name: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  items: ItineraryEntry[];
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("id", tripId)
    .single();

  if (!trip) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data, error } = await db
    .from("trip_items")
    .select(
      `id, title, item_type, description, stage, deadline_at, assigned_to_line_user_id, booking_status, booking_ref, confirmed_option_id,
       trip_item_options!trip_items_confirmed_option_id_fkey (
         id, name, address, image_url, rating, price_level, booking_url, google_maps_url, lat, lng
       )`
    )
    .eq("trip_id", tripId)
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load itinerary", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const items: ItineraryEntry[] = (data ?? []).map((row) => {
    const opt = Array.isArray(row.trip_item_options)
      ? row.trip_item_options[0]
      : row.trip_item_options;
    return {
      id: row.id as string,
      title: row.title as string,
      item_type: row.item_type as string,
      description: (row.description as string | null) ?? null,
      stage: row.stage as string,
      deadline_at: (row.deadline_at as string | null) ?? null,
      assigned_to_line_user_id: (row.assigned_to_line_user_id as string | null) ?? null,
      booking_status: (row.booking_status as string) ?? "not_required",
      booking_ref: (row.booking_ref as string | null) ?? null,
      confirmed_option: opt
        ? {
            id: opt.id as string,
            name: opt.name as string,
            address: (opt.address as string | null) ?? null,
            image_url: (opt.image_url as string | null) ?? null,
            rating: (opt.rating as number | null) ?? null,
            price_level: (opt.price_level as string | null) ?? null,
            booking_url: (opt.booking_url as string | null) ?? null,
            google_maps_url: (opt.google_maps_url as string | null) ?? null,
            lat: opt.lat != null ? Number(opt.lat) : null,
            lng: opt.lng != null ? Number(opt.lng) : null,
          }
        : null,
    };
  });

  return NextResponse.json<ItineraryResponse>({
    trip: {
      id: trip.id as string,
      destination_name: (trip.destination_name as string | null) ?? null,
      start_date: (trip.start_date as string | null) ?? null,
      end_date: (trip.end_date as string | null) ?? null,
    },
    items,
  });
}
