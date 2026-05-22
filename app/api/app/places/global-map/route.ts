import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppUser } from "@/lib/app-server";

export interface GlobalMapPlace {
  id: string;
  kind: "item" | "option" | "memory";
  stage: "confirmed" | "pending" | "todo" | "shared";
  itemType: string;
  title: string;
  subtitle: string | null;
  lat: number;
  lng: number;
  bookingUrl: string | null;
  googleMapsUrl: string | null;
  tripId: string;
  tripName: string | null;
  dayKey: string | null;
}

export interface GlobalMapTripSummary {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  destinationLat: number | null;
  destinationLng: number | null;
  placeCount: number;
}

export interface GlobalMapResponse {
  trips: GlobalMapTripSummary[];
  places: GlobalMapPlace[];
}

/**
 * GET /api/app/places/global-map
 *
 * Aggregates every database-stored place across the user's reachable trips
 * into a single payload for the top-level /app/map view. Reachability mirrors
 * the rules used by the trips list page: group_members → trips, plus direct
 * trip_members rows.
 *
 * Sources:
 *  - `trip_item_options` linked via `trip_items.confirmed_option_id` (the
 *    confirmed itinerary places)
 *  - `trip_item_options` for items currently in voting (`stage = 'pending'`)
 *  - `trip_memories` (places parsed from chat or shared via /share)
 *
 * Rows without coordinates are filtered out; geocode backfill happens on the
 * per-trip endpoints, not here.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const tripIdSet = new Set<string>();

  // 1) Trips reachable via LINE group_members.
  const { data: groupRows } = await db
    .from("group_members")
    .select("group_id")
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null);
  const groupIds = Array.from(
    new Set((groupRows ?? []).map((r) => r.group_id as string).filter(Boolean))
  );
  if (groupIds.length > 0) {
    const { data: groupTrips } = await db
      .from("trips")
      .select("id")
      .in("group_id", groupIds);
    for (const t of groupTrips ?? []) tripIdSet.add(t.id as string);
  }

  // 2) Trips reachable via direct trip_members.
  const { data: directRows } = await db
    .from("trip_members")
    .select("trip_id")
    .eq("app_user_id", auth.appUserId)
    .is("left_at", null);
  for (const r of directRows ?? []) tripIdSet.add(r.trip_id as string);

  const tripIds = Array.from(tripIdSet);
  if (tripIds.length === 0) {
    return NextResponse.json<GlobalMapResponse>({ trips: [], places: [] });
  }

  // Trip summaries (also act as the source of `tripName` for each pin).
  const { data: tripRows } = await db
    .from("trips")
    .select(
      "id, destination_name, start_date, end_date, status, destination_lat, destination_lng"
    )
    .in("id", tripIds);

  const tripNameById = new Map<string, string | null>();
  const trips: GlobalMapTripSummary[] = (tripRows ?? []).map((t) => {
    const id = t.id as string;
    const name = (t.destination_name as string | null) ?? null;
    tripNameById.set(id, name);
    return {
      id,
      name,
      startDate: (t.start_date as string | null) ?? null,
      endDate: (t.end_date as string | null) ?? null,
      status: t.status as string,
      destinationLat:
        t.destination_lat != null ? Number(t.destination_lat) : null,
      destinationLng:
        t.destination_lng != null ? Number(t.destination_lng) : null,
      placeCount: 0,
    };
  });

  const places: GlobalMapPlace[] = [];

  // ─── Confirmed itinerary options + their parent item info ──────────────────
  const { data: items } = await db
    .from("trip_items")
    .select(
      `id, trip_id, title, item_type, stage, deadline_at, confirmed_option_id,
       trip_item_options!trip_items_confirmed_option_id_fkey (
         id, name, address, lat, lng, booking_url, google_maps_url
       )`
    )
    .in("trip_id", tripIds)
    .in("stage", ["confirmed", "pending", "todo"]);

  for (const item of items ?? []) {
    const opt = Array.isArray(item.trip_item_options)
      ? item.trip_item_options[0]
      : item.trip_item_options;
    if (!opt || opt.lat == null || opt.lng == null) continue;
    const tripId = item.trip_id as string;
    places.push({
      id: `item:${item.id as string}`,
      kind: "item",
      stage: (item.stage as GlobalMapPlace["stage"]) ?? "todo",
      itemType: (item.item_type as string) ?? "other",
      title: (item.title as string) ?? (opt.name as string) ?? "Untitled",
      subtitle: (opt.address as string | null) ?? null,
      lat: Number(opt.lat),
      lng: Number(opt.lng),
      bookingUrl: (opt.booking_url as string | null) ?? null,
      googleMapsUrl: (opt.google_maps_url as string | null) ?? null,
      tripId,
      tripName: tripNameById.get(tripId) ?? null,
      dayKey: dateKey(item.deadline_at as string | null),
    });
  }

  // ─── Pending vote options (options not yet confirmed) ──────────────────────
  // Only include rows for items currently in the voting stage, to keep the
  // pin set focused on "decisions in flight".
  const pendingItemIds = (items ?? [])
    .filter((i) => (i.stage as string) === "pending")
    .map((i) => i.id as string);
  if (pendingItemIds.length > 0) {
    const { data: voteOpts } = await db
      .from("trip_item_options")
      .select(
        "id, trip_item_id, name, address, lat, lng, booking_url, google_maps_url"
      )
      .in("trip_item_id", pendingItemIds);
    const itemMeta = new Map(
      (items ?? []).map((i) => [
        i.id as string,
        {
          tripId: i.trip_id as string,
          itemType: (i.item_type as string) ?? "other",
          dayKey: dateKey(i.deadline_at as string | null),
          confirmedOptionId: (i.confirmed_option_id as string | null) ?? null,
        },
      ])
    );
    for (const o of voteOpts ?? []) {
      if (o.lat == null || o.lng == null) continue;
      const meta = itemMeta.get(o.trip_item_id as string);
      if (!meta) continue;
      if (meta.confirmedOptionId && meta.confirmedOptionId === o.id) continue;
      places.push({
        id: `option:${o.id as string}`,
        kind: "option",
        stage: "pending",
        itemType: meta.itemType,
        title: (o.name as string) ?? "Untitled option",
        subtitle: (o.address as string | null) ?? null,
        lat: Number(o.lat),
        lng: Number(o.lng),
        bookingUrl: (o.booking_url as string | null) ?? null,
        googleMapsUrl: (o.google_maps_url as string | null) ?? null,
        tripId: meta.tripId,
        tripName: tripNameById.get(meta.tripId) ?? null,
        dayKey: meta.dayKey,
      });
    }
  }

  // ─── Memories (chat-mentioned / shared places) ─────────────────────────────
  const { data: mems } = await db
    .from("trip_memories")
    .select("id, trip_id, title, item_type, address, lat, lng, booking_url")
    .in("trip_id", tripIds);
  for (const m of mems ?? []) {
    if (m.lat == null || m.lng == null) continue;
    const tripId = m.trip_id as string;
    places.push({
      id: `memory:${m.id as string}`,
      kind: "memory",
      stage: "shared",
      itemType: (m.item_type as string) ?? "other",
      title: (m.title as string) ?? "Shared place",
      subtitle: (m.address as string | null) ?? null,
      lat: Number(m.lat),
      lng: Number(m.lng),
      bookingUrl: (m.booking_url as string | null) ?? null,
      googleMapsUrl: null,
      tripId,
      tripName: tripNameById.get(tripId) ?? null,
      dayKey: null,
    });
  }

  // Stamp placeCount per trip for the legend.
  const countByTrip = new Map<string, number>();
  for (const p of places) {
    countByTrip.set(p.tripId, (countByTrip.get(p.tripId) ?? 0) + 1);
  }
  for (const t of trips) {
    t.placeCount = countByTrip.get(t.id) ?? 0;
  }

  return NextResponse.json<GlobalMapResponse>({ trips, places });
}

function dateKey(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toISOString().split("T")[0];
}
