import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { castVote, closeVote } from "@/services/vote";
import { announceWinner, refreshVoteCarousel } from "@/services/decisions";
import { requireTripMembership, requireVoteAccess } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

// ─── GET /api/liff/votes ──────────────────────────────────────────────────────
// Returns all pending (in-vote) trip items with options and current tallies.
//
// Query params:
//   tripId     (UUID)    required
//   lineUserId (string)  optional — marks which option the caller voted for

const GetSchema = z.object({
  tripId: z.string().uuid(),
});

export interface VoteOption {
  id: string;
  name: string;
  image_url: string | null;
  rating: number | null;
  price_level: string | null;
  booking_url: string | null;
  voteCount: number;
  votedByMe: boolean;
}

export interface ActiveVote {
  item: {
    id: string;
    title: string;
    item_type: string;
    deadline_at: string | null;
  };
  options: VoteOption[];
  totalVotes: number;
  myVoteOptionId: string | null;
}

export interface VotesResponse {
  votes: ActiveVote[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const parsed = GetSchema.safeParse({
    tripId: searchParams.get("tripId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tripId } = parsed.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;
  const lineUserId = membership.lineUserId;
  const db = createAdminClient();

  // 1. Get pending items
  const { data: pendingItems, error: itemsErr } = await db
    .from("trip_items")
    .select("id, title, item_type, deadline_at")
    .eq("trip_id", tripId)
    .eq("stage", "pending")
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return NextResponse.json<ApiError>(
      { error: "Failed to fetch pending items", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  if (!pendingItems?.length) {
    return NextResponse.json<VotesResponse>({ votes: [] });
  }

  const itemIds = pendingItems.map((i) => i.id as string);

  // 2. Get options for all pending items
  const { data: options, error: optErr } = await db
    .from("trip_item_options")
    .select("id, trip_item_id, name, image_url, rating, price_level, booking_url")
    .in("trip_item_id", itemIds);

  if (optErr) {
    return NextResponse.json<ApiError>(
      { error: "Failed to fetch options", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  // 3. Get votes for all pending items
  const { data: votes, error: votesErr } = await db
    .from("votes")
    .select("trip_item_id, option_id, line_user_id")
    .in("trip_item_id", itemIds);

  if (votesErr) {
    return NextResponse.json<ApiError>(
      { error: "Failed to fetch votes", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  // 4. Aggregate
  const optionRows = options ?? [];
  const voteRows = votes ?? [];

  const result: ActiveVote[] = pendingItems.map((item) => {
    const itemOptions = optionRows.filter((o) => o.trip_item_id === item.id);
    const itemVotes = voteRows.filter((v) => v.trip_item_id === item.id);

    // tally votes per option
    const tally = new Map<string, number>();
    for (const v of itemVotes) {
      const optId = v.option_id as string;
      tally.set(optId, (tally.get(optId) ?? 0) + 1);
    }

    // find this user's vote
    const myVote = lineUserId
      ? itemVotes.find((v) => v.line_user_id === lineUserId)
      : null;
    const myVoteOptionId = myVote ? (myVote.option_id as string) : null;

    const voteOptions: VoteOption[] = itemOptions.map((o) => ({
      id: o.id as string,
      name: o.name as string,
      image_url: (o.image_url as string | null) ?? null,
      rating: o.rating != null ? Number(o.rating) : null,
      price_level: (o.price_level as string | null) ?? null,
      booking_url: (o.booking_url as string | null) ?? null,
      voteCount: tally.get(o.id as string) ?? 0,
      votedByMe: myVoteOptionId === (o.id as string),
    }));

    return {
      item: {
        id: item.id as string,
        title: item.title as string,
        item_type: item.item_type as string,
        deadline_at: (item.deadline_at as string | null) ?? null,
      },
      options: voteOptions,
      totalVotes: itemVotes.length,
      myVoteOptionId,
    };
  });

  return NextResponse.json<VotesResponse>({ votes: result });
}

// ─── POST /api/liff/votes ─────────────────────────────────────────────────────
// Cast a vote from the LIFF dashboard.
// Requires a valid LINE LIFF ID token in the Authorization: Bearer <token> header.

const BodySchema = z.object({
  tripItemId: z.string().uuid(),
  optionId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tripItemId, optionId } = parsed.data;
  const voteAccess = await requireVoteAccess(req, tripItemId);
  if (!voteAccess.ok) return voteAccess.response;

  const { lineUserId, groupId, lineGroupId } = voteAccess;

  const result = await castVote({ tripItemId, optionId, groupId, lineUserId });

  if (!result.accepted) {
    return NextResponse.json<ApiError>(
      { error: result.error ?? "Vote not accepted", code: "VOTE_REJECTED" },
      { status: 409 }
    );
  }

  const tally = Object.fromEntries(result.tally);

  if (result.majority.reached && result.majority.winningOptionId) {
    const { closed } = await closeVote(
      tripItemId,
      result.majority.winningOptionId,
      groupId,
      result.totalVotes
    );

    if (closed) {
      await announceWinner(
        tripItemId,
        result.majority.winningOptionId,
        lineGroupId,
        result.majority.winningCount,
        result.totalVotes
      );
    }

    const db = createAdminClient();
    const { data: item } = await db
      .from("trip_items")
      .select("id, stage, confirmed_option_id")
      .eq("id", tripItemId)
      .single();

    return NextResponse.json({
      accepted: true,
      tally,
      totalVotes: result.totalVotes,
      closed: true,
      winningOptionId: result.majority.winningOptionId,
      item: item ?? null,
    });
  }

  await refreshVoteCarousel(tripItemId, lineGroupId);

  return NextResponse.json({
    accepted: true,
    tally,
    totalVotes: result.totalVotes,
    closed: false,
  });
}
