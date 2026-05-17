import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { geocodeAddress } from "@/services/decisions/places";

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
  item_kind: string;
  description: string | null;
  stage: string;
  deadline_at: string | null;
  source_inputs: Record<string, unknown> | null;
  assigned_to_line_user_id: string | null;
  booking_status: string;
  booking_ref: string | null;
  confirmed_option: ItineraryOption | null;
}

export interface DayNoteEntry {
  note: string;
  updatedBy: string;
  updatedByName: string | null;
  updatedAt: string;
}

export interface ItineraryResponse {
  trip: {
    id: string;
    destination_name: string | null;
    start_date: string | null;
    end_date: string | null;
    budget_currency: string;
    day_notes: Record<string, DayNoteEntry>;
  };
  items: ItineraryEntry[];
}

const GEOCODE_BACKFILL_LIMIT = 5;

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select(
      "id, destination_name, start_date, end_date, budget_currency, day_notes"
    )
    .eq("id", tripId)
    .single();

  if (!trip) {
    return NextResponse.json(
      { error: "找不到旅程", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data, error } = await db
    .from("trip_items")
    .select(
      `id, title, item_type, description, stage, deadline_at, source_inputs, assigned_to_line_user_id, booking_status, booking_ref, confirmed_option_id,
       item_kind,
       trip_item_options!trip_items_confirmed_option_id_fkey (
         id, name, address, image_url, rating, price_level, booking_url, google_maps_url, lat, lng
       )`
    )
    .eq("trip_id", tripId)
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "行程載入失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const items: ItineraryEntry[] = await Promise.all((data ?? []).map(async (row) => {
    const opt = Array.isArray(row.trip_item_options)
      ? row.trip_item_options[0]
      : row.trip_item_options;
    if (
      opt?.address &&
      (opt.lat == null || opt.lng == null) &&
      GEOCODE_BACKFILL_LIMIT > 0
    ) {
      const addressOnlyRows = (data ?? []).filter((candidate) => {
        const candidateOpt = Array.isArray(candidate.trip_item_options)
          ? candidate.trip_item_options[0]
          : candidate.trip_item_options;
        return (
          candidateOpt?.address &&
          (candidateOpt.lat == null || candidateOpt.lng == null)
        );
      });
      const shouldBackfill = addressOnlyRows
        .slice(0, GEOCODE_BACKFILL_LIMIT)
        .some((candidate) => candidate.id === row.id);

      if (shouldBackfill) {
        const coords = await geocodeAddress(opt.address as string);
        if (coords) {
          opt.lat = coords.lat;
          opt.lng = coords.lng;
          await db
            .from("trip_item_options")
            .update({ lat: coords.lat, lng: coords.lng })
            .eq("id", opt.id);
        }
      }
    }
    return {
      id: row.id as string,
      title: row.title as string,
      item_type: row.item_type as string,
      item_kind: (row.item_kind as string | null) ?? "task",
      description: (row.description as string | null) ?? null,
      stage: row.stage as string,
      deadline_at: (row.deadline_at as string | null) ?? null,
      source_inputs: (row.source_inputs as Record<string, unknown> | null) ?? null,
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
  }));

  return NextResponse.json<ItineraryResponse>({
    trip: {
      id: trip.id as string,
      destination_name: (trip.destination_name as string | null) ?? null,
      start_date: (trip.start_date as string | null) ?? null,
      end_date: (trip.end_date as string | null) ?? null,
      budget_currency: (trip.budget_currency as string | null) ?? "TWD",
      day_notes:
        (trip.day_notes as Record<string, DayNoteEntry> | null) ?? {},
    },
    items,
  });
}
