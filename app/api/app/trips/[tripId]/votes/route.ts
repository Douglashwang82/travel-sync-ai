import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { castVote, closeVote } from "@/services/vote";
import { announceWinner, refreshVoteCarousel } from "@/services/decisions";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface WebVoteOption {
  id: string;
  name: string;
  address: string | null;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  bookingUrl: string | null;
  googleMapsUrl: string | null;
  voteCount: number;
  voters: Array<{ lineUserId: string; displayName: string | null }>;
  votedByMe: boolean;
}

export interface WebActiveVote {
  item: {
    id: string;
    title: string;
    description: string | null;
    itemType: string;
    deadlineAt: string | null;
  };
  options: WebVoteOption[];
  totalVotes: number;
  myOptionId: string | null;
  memberCount: number;
}

export interface WebVotesResponse {
  votes: WebActiveVote[];
  memberCount: number;
}

/**
 * GET /api/app/trips/:tripId/votes
 *
 * Returns all pending-stage items with their options, vote counts, and the
 * caller's current selection. Voter display names are inlined so the web
 * UI can render avatars/names without an extra round-trip.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const { data: items, error: itemsErr } = await db
    .from("trip_items")
    .select("id, title, description, item_type, deadline_at")
    .eq("trip_id", tripId)
    .eq("stage", "pending")
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return NextResponse.json(
      { error: "Failed to load votes", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const { count: memberCount } = await db
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", auth.groupId)
    .is("left_at", null);

  if (!items?.length) {
    return NextResponse.json<WebVotesResponse>({
      votes: [],
      memberCount: memberCount ?? 0,
    });
  }

  const itemIds = items.map((i) => i.id as string);

  const [optionsRes, votesRes, membersRes] = await Promise.all([
    db
      .from("trip_item_options")
      .select(
        "id, trip_item_id, name, address, image_url, rating, price_level, booking_url, google_maps_url"
      )
      .in("trip_item_id", itemIds),
    db
      .from("votes")
      .select("trip_item_id, option_id, line_user_id")
      .in("trip_item_id", itemIds),
    db
      .from("group_members")
      .select("line_user_id, display_name")
      .eq("group_id", auth.groupId)
      .is("left_at", null),
  ]);

  if (optionsRes.error || votesRes.error || membersRes.error) {
    return NextResponse.json(
      { error: "Failed to load vote details", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const optionRows = optionsRes.data ?? [];
  const voteRows = votesRes.data ?? [];
  const memberById = new Map(
    (membersRes.data ?? []).map((m) => [
      m.line_user_id as string,
      (m.display_name as string | null) ?? null,
    ])
  );

  const votes: WebActiveVote[] = items.map((item) => {
    const itemId = item.id as string;
    const itemOptions = optionRows.filter((o) => o.trip_item_id === itemId);
    const itemVotes = voteRows.filter((v) => v.trip_item_id === itemId);

    const tally = new Map<string, number>();
    const votersByOption = new Map<
      string,
      Array<{ lineUserId: string; displayName: string | null }>
    >();
    for (const v of itemVotes) {
      const optId = v.option_id as string;
      tally.set(optId, (tally.get(optId) ?? 0) + 1);
      const userId = v.line_user_id as string;
      const voters = votersByOption.get(optId) ?? [];
      voters.push({ lineUserId: userId, displayName: memberById.get(userId) ?? null });
      votersByOption.set(optId, voters);
    }

    const myVote = itemVotes.find((v) => v.line_user_id === auth.lineUserId);
    const myOptionId = myVote ? (myVote.option_id as string) : null;

    const options: WebVoteOption[] = itemOptions.map((o) => ({
      id: o.id as string,
      name: o.name as string,
      address: (o.address as string | null) ?? null,
      imageUrl: (o.image_url as string | null) ?? null,
      rating: o.rating != null ? Number(o.rating) : null,
      priceLevel: (o.price_level as string | null) ?? null,
      bookingUrl: (o.booking_url as string | null) ?? null,
      googleMapsUrl: (o.google_maps_url as string | null) ?? null,
      voteCount: tally.get(o.id as string) ?? 0,
      voters: votersByOption.get(o.id as string) ?? [],
      votedByMe: myOptionId === (o.id as string),
    }));

    return {
      item: {
        id: itemId,
        title: item.title as string,
        description: (item.description as string | null) ?? null,
        itemType: item.item_type as string,
        deadlineAt: (item.deadline_at as string | null) ?? null,
      },
      options,
      totalVotes: itemVotes.length,
      myOptionId,
      memberCount: memberCount ?? 0,
    };
  });

  return NextResponse.json<WebVotesResponse>({
    votes,
    memberCount: memberCount ?? 0,
  });
}

const CastSchema = z.object({
  tripItemId: z.string().uuid(),
  optionId: z.string().uuid(),
});

/**
 * POST /api/app/trips/:tripId/votes — cast or change a vote.
 *
 * Matches the LIFF behaviour: if the cast takes the option to majority, the
 * item is immediately confirmed and the booking flow opens.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
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

  const parsed = CastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  // Verify the item belongs to this trip (prevents cross-trip vote injection).
  const db = createAdminClient();
  const { data: item } = await db
    .from("trip_items")
    .select("id, trip_id")
    .eq("id", parsed.data.tripItemId)
    .single();
  if (!item || item.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Item not found in this trip", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const result = await castVote({
    tripItemId: parsed.data.tripItemId,
    optionId: parsed.data.optionId,
    groupId: auth.groupId,
    lineUserId: auth.lineUserId,
  });

  if (!result.accepted) {
    return NextResponse.json(
      { error: result.error ?? "Vote not accepted", code: "VOTE_REJECTED" },
      { status: 409 }
    );
  }

  const tally = Object.fromEntries(result.tally);

  // Resolve the LINE group ID once — needed for chat side effects below.
  const { data: lineGroup } = await db
    .from("line_groups")
    .select("line_group_id")
    .eq("id", auth.groupId)
    .single();
  const lineGroupId = lineGroup?.line_group_id as string | null;

  let closed = false;
  if (result.majority.reached && result.majority.winningOptionId) {
    const { closed: didClose } = await closeVote(
      parsed.data.tripItemId,
      result.majority.winningOptionId,
      auth.groupId,
      result.totalVotes
    );
    closed = didClose;
    if (closed && lineGroupId) {
      const winnerVotes = result.tally.get(result.majority.winningOptionId) ?? 0;
      await announceWinner(
        parsed.data.tripItemId,
        result.majority.winningOptionId,
        lineGroupId,
        winnerVotes,
        result.totalVotes
      ).catch(() => {/* non-fatal: LINE message failure should not fail the API response */});
    }
  } else if (lineGroupId) {
    await refreshVoteCarousel(parsed.data.tripItemId, lineGroupId).catch(() => {/* non-fatal */});
  }

  return NextResponse.json({
    accepted: true,
    tally,
    totalVotes: result.totalVotes,
    closed,
    winningOptionId: closed ? result.majority.winningOptionId : null,
  });
}
