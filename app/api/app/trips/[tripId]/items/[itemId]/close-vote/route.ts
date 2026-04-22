import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppOrganizer } from "@/lib/app-server";
import { closeVote } from "@/services/vote";
import type { TripItem } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string; itemId: string }> };

const BodySchema = z.object({
  winningOptionId: z.string().uuid(),
});

/**
 * POST /api/app/trips/:tripId/items/:itemId/close-vote
 *
 * Organizer-only. Closes a pending-stage vote early by confirming a winning
 * option. Uses the existing closeVote service so analytics/booking-status
 * handling stays identical to the LIFF and cron paths.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, itemId } = await ctx.params;
  const auth = await requireAppOrganizer(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: item } = await db
    .from("trip_items")
    .select("id, trip_id, stage")
    .eq("id", itemId)
    .single();
  if (!item || item.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Item not found in this trip", code: "NOT_FOUND" },
      { status: 404 }
    );
  }
  if (item.stage !== "pending") {
    return NextResponse.json(
      {
        error: `Cannot close a vote that is ${item.stage}`,
        code: "INVALID_STAGE",
      },
      { status: 422 }
    );
  }

  const { data: option } = await db
    .from("trip_item_options")
    .select("id")
    .eq("id", parsed.data.winningOptionId)
    .eq("trip_item_id", itemId)
    .single();
  if (!option) {
    return NextResponse.json(
      { error: "That option does not belong to this vote", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { count: totalVotes } = await db
    .from("votes")
    .select("*", { count: "exact", head: true })
    .eq("trip_item_id", itemId);

  const { closed } = await closeVote(
    itemId,
    parsed.data.winningOptionId,
    auth.groupId,
    totalVotes ?? 0
  );

  if (!closed) {
    return NextResponse.json(
      { error: "Vote was already closed", code: "ALREADY_CLOSED" },
      { status: 409 }
    );
  }

  const { data: updated } = await db
    .from("trip_items")
    .select("*")
    .eq("id", itemId)
    .single();

  return NextResponse.json<{ item: TripItem }>({ item: updated as TripItem });
}
