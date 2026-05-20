import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import type { BoardData, TripItem } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: trip, error: tripErr } = await db
    .from("trips")
    .select(
      "id, destination_name, destination_place_id, destination_formatted_address, destination_google_maps_url, destination_lat, destination_lng, destination_timezone, destination_source_last_synced_at, start_date, end_date, status"
    )
    .eq("id", tripId)
    .single();

  if (tripErr || !trip) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data: items, error: itemsErr } = await db
    .from("trip_items")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return NextResponse.json(
      { error: "Failed to load board", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const all = (items ?? []) as TripItem[];

  // Resolve a cover image per item from `trip_item_options`. Prefer the
  // confirmed option; fall back to any option on the item that has an image.
  // One round-trip for the whole board keeps this cheap.
  const itemIds = all.map((i) => i.id);
  const covers: NonNullable<BoardData["covers"]> = {};
  if (itemIds.length > 0) {
    const { data: options } = await db
      .from("trip_item_options")
      .select("trip_item_id, id, image_url, photo_name")
      .in("trip_item_id", itemIds);

    const byItem = new Map<string, Array<{ id: string; imageUrl: string | null; photoName: string | null }>>();
    for (const o of options ?? []) {
      const list = byItem.get(o.trip_item_id as string) ?? [];
      list.push({
        id: o.id as string,
        imageUrl: (o.image_url as string | null) ?? null,
        photoName: (o.photo_name as string | null) ?? null,
      });
      byItem.set(o.trip_item_id as string, list);
    }

    for (const item of all) {
      const opts = byItem.get(item.id);
      if (!opts || opts.length === 0) continue;
      const confirmed = item.confirmed_option_id
        ? opts.find((o) => o.id === item.confirmed_option_id)
        : null;
      const pick =
        confirmed && (confirmed.imageUrl || confirmed.photoName)
          ? confirmed
          : opts.find((o) => o.imageUrl || o.photoName);
      if (pick) {
        covers[item.id] = { imageUrl: pick.imageUrl, photoName: pick.photoName };
      }
    }
  }

  const board: BoardData = {
    trip: trip as BoardData["trip"],
    todo: all.filter((i) => i.stage === "todo"),
    pending: all.filter((i) => i.stage === "pending"),
    confirmed: all.filter((i) => i.stage === "confirmed"),
    covers,
    currentUser: {
      lineUserId: auth.lineUserId,
      role: auth.role,
    },
  };
  return NextResponse.json(board);
}
