import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError, BoardData, TripItem } from "@/lib/types";

const BoardQuerySchema = z.object({
  tripId: z.string().uuid(),
});

/**
 * GET /api/liff/board?tripId=...
 *
 * Returns board items grouped by stage for the LIFF dashboard.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const result = BoardQuerySchema.safeParse({ tripId: searchParams.get("tripId") });
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
    .select(`
      id,
      destination_name,
      destination_place_id,
      destination_formatted_address,
      destination_google_maps_url,
      destination_lat,
      destination_lng,
      destination_timezone,
      destination_source_last_synced_at,
      start_date,
      end_date,
      status
    `)
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
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load board", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const allItems = (items ?? []) as TripItem[];

  const board: BoardData = {
    trip: trip as BoardData["trip"],
    todo: allItems.filter((i) => i.stage === "todo"),
    pending: allItems.filter((i) => i.stage === "pending"),
    confirmed: allItems.filter((i) => i.stage === "confirmed"),
    currentUser: {
      lineUserId: membership.lineUserId,
      role: membership.membership.role,
    },
  };

  return NextResponse.json(board);
}
