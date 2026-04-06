import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { castVote, closeVote } from "@/services/vote";
import { announceWinner, refreshVoteCarousel } from "@/services/decisions";
import { verifyLiffToken, extractBearerToken } from "@/lib/liff-auth";
import type { ApiError } from "@/lib/types";

const BodySchema = z.object({
  tripItemId: z.string().uuid(),
  optionId: z.string().uuid(),
  lineGroupId: z.string().min(1),   // LINE group ID (not DB UUID) for push messages
  groupId: z.string().uuid(),       // DB group UUID
});

/**
 * POST /api/liff/votes
 *
 * Cast a vote from the LIFF dashboard.
 * Requires a valid LINE LIFF ID token in the Authorization: Bearer <token> header.
 * The verified lineUserId is extracted from the token — the body never supplies it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const idToken = extractBearerToken(req.headers.get("Authorization"));
  if (!idToken) {
    return NextResponse.json<ApiError>(
      { error: "Missing Authorization header", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const lineUserId = await verifyLiffToken(idToken);
  if (!lineUserId) {
    return NextResponse.json<ApiError>(
      { error: "Invalid or expired LIFF token", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // ── Validation ────────────────────────────────────────────────────────────
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

  const { tripItemId, optionId, lineGroupId, groupId } = parsed.data;

  // ── Cast vote ─────────────────────────────────────────────────────────────
  const result = await castVote({ tripItemId, optionId, groupId, lineUserId });

  if (!result.accepted) {
    return NextResponse.json<ApiError>(
      { error: result.error ?? "Vote not accepted", code: "VOTE_REJECTED" },
      { status: 409 }
    );
  }

  const tally = Object.fromEntries(result.tally);

  // ── Majority reached → close once ─────────────────────────────────────────
  if (result.majority.reached && result.majority.winningOptionId) {
    const { closed } = await closeVote(
      tripItemId,
      result.majority.winningOptionId,
      groupId,
      result.totalVotes
    );

    if (closed) {
      // Only announce if this request performed the close (prevents double-announce)
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

  // ── Vote recorded, not yet closed → push live tally to the LINE group ─────
  await refreshVoteCarousel(tripItemId, lineGroupId);

  return NextResponse.json({
    accepted: true,
    tally,
    totalVotes: result.totalVotes,
    closed: false,
  });
}
