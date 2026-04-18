import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

export interface RouteStop {
  id: string;
  title: string;
  item_type: string;
  confirmed_option: {
    id: string;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    google_maps_url: string | null;
  } | null;
  /** Distance in km from the previous stop (null for the first stop). */
  distance_from_prev_km: number | null;
}

export interface RouteData {
  trip: {
    id: string;
    destination_name: string;
    destination_lat: number | null;
    destination_lng: number | null;
    start_date: string | null;
    end_date: string | null;
  };
  stops: RouteStop[];
  /** Items that have no coordinates and were excluded from optimization. */
  unrouted: { id: string; title: string; item_type: string }[];
}

/** Haversine great-circle distance in kilometres. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type RawStop = {
  id: string;
  title: string;
  item_type: string;
  lat: number;
  lng: number;
  confirmed_option: RouteStop["confirmed_option"];
};

/**
 * Nearest-neighbour TSP heuristic.
 * Starts from the given origin (trip destination), then repeatedly visits
 * the closest unvisited stop. O(n²) — fine for typical trip sizes (< 50 stops).
 */
function nearestNeighbour(
  origin: { lat: number; lng: number },
  stops: RawStop[]
): { ordered: RawStop[]; distances: number[] } {
  const remaining = [...stops];
  const ordered: RawStop[] = [];
  const distances: number[] = [];

  let cur = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    distances.push(bestDist);
    cur = { lat: next.lat, lng: next.lng };
  }

  return { ordered, distances };
}

/**
 * GET /api/liff/route?tripId=...
 *
 * Returns confirmed trip items ordered by nearest-neighbour route optimisation.
 * Items without coordinates are listed separately as `unrouted`.
 * The origin is the trip's destination lat/lng (if available), otherwise
 * the first geolocated stop is used as the anchor.
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
    .select("id, destination_name, destination_lat, destination_lng, start_date, end_date")
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
      confirmed_option_id,
      trip_item_options!trip_items_confirmed_option_id_fkey (
        id,
        name,
        address,
        lat,
        lng,
        google_maps_url
      )
    `)
    .eq("trip_id", tripId)
    .eq("stage", "confirmed")
    .order("created_at", { ascending: true });

  if (itemsError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load items", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const routable: RawStop[] = [];
  const unrouted: RouteData["unrouted"] = [];

  for (const item of items ?? []) {
    const opt = Array.isArray(item.trip_item_options)
      ? item.trip_item_options[0]
      : item.trip_item_options;

    const confirmed_option = opt
      ? {
          id: opt.id,
          name: opt.name,
          address: opt.address ?? null,
          lat: opt.lat ?? null,
          lng: opt.lng ?? null,
          google_maps_url: opt.google_maps_url ?? null,
        }
      : null;

    if (confirmed_option?.lat != null && confirmed_option.lng != null) {
      routable.push({
        id: item.id,
        title: item.title,
        item_type: item.item_type,
        lat: confirmed_option.lat,
        lng: confirmed_option.lng,
        confirmed_option,
      });
    } else {
      unrouted.push({ id: item.id, title: item.title, item_type: item.item_type });
    }
  }

  let stops: RouteStop[] = [];

  if (routable.length > 0) {
    const origin =
      trip.destination_lat != null && trip.destination_lng != null
        ? { lat: trip.destination_lat, lng: trip.destination_lng }
        : { lat: routable[0].lat, lng: routable[0].lng };

    const { ordered, distances } = nearestNeighbour(origin, routable);

    stops = ordered.map((s, i) => ({
      id: s.id,
      title: s.title,
      item_type: s.item_type,
      confirmed_option: s.confirmed_option,
      distance_from_prev_km: Math.round(distances[i] * 10) / 10,
    }));
  }

  const response: RouteData = {
    trip: {
      id: trip.id,
      destination_name: trip.destination_name,
      destination_lat: trip.destination_lat ?? null,
      destination_lng: trip.destination_lng ?? null,
      start_date: trip.start_date ?? null,
      end_date: trip.end_date ?? null,
    },
    stops,
    unrouted,
  };

  return NextResponse.json(response);
}
