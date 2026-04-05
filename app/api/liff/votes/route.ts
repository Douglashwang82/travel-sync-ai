import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { castVote, closeVote } from "@/services/vote";
import { announceWinner } from "@/services/decisions";
import type { ApiError } from "@/lib/types";

const BodySchema = z.object({
  tripItemId: z.string().uuid(),
  optionId: z.string().uuid(),
  lineUserId: z.string().min(1),
  lineGroupId: z.string().min(1),   // LINE group ID (not DB UUID) for push messages
  groupId: z.string().uuid(),       // DB group UUID
});

/**
 * POST /api/liff/votes
 *
 * Cast a vote from the LIFF dashboard (for future use when LIFF shows
 * the pending vote cards). Mirrors the postback handler logic.
 */
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

  const { tripItemId, optionId, lineUserId, lineGroupId, groupId } = parsed.data;

  const result = await castVote({
    tripItemId,
    optionId,
    groupId,
    lineUserId,
  });

  if (!result.accepted) {
    return NextResponse.json<ApiError>(
      { error: result.error ?? "Vote not accepted", code: "VOTE_REJECTED" },
      { status: 409 }
    );
  }

  // Convert tally Map to plain object for JSON response
  const tally = Object.fromEntries(result.tally);

  if (result.majority.reached && result.majority.winningOptionId) {
    await closeVote(tripItemId, result.majority.winningOptionId, groupId);
    await announceWinner(tripItemId, result.majority.winningOptionId, groupId, lineGroupId);

    // Fetch updated item
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

  return NextResponse.json({
    accepted: true,
    tally,
    totalVotes: result.totalVotes,
    closed: false,
  });
}
