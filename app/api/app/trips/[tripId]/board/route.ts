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
  const board: BoardData = {
    trip: trip as BoardData["trip"],
    todo: all.filter((i) => i.stage === "todo"),
    pending: all.filter((i) => i.stage === "pending"),
    confirmed: all.filter((i) => i.stage === "confirmed"),
    currentUser: {
      lineUserId: auth.lineUserId,
      role: auth.role,
    },
  };
  return NextResponse.json(board);
}
