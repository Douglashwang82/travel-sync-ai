import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";
import { getOperationsSummary } from "@/services/operations";
import { track } from "@/lib/analytics";

const OperationsQuerySchema = z.object({
  tripId: z.string().uuid(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const parsed = OperationsQuerySchema.safeParse({
    tripId: searchParams.get("tripId"),
  });

  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "tripId is required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const membership = await requireTripMembership(req, parsed.data.tripId);
  if (!membership.ok) return membership.response;

  const summary = await getOperationsSummary(parsed.data.tripId);
  if (!summary) {
    return NextResponse.json<ApiError>(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  await track("ops_view_opened", {
    groupId: membership.membership.groupId,
    userId: membership.lineUserId,
    properties: {
      trip_id: parsed.data.tripId,
      phase: summary.phase,
      degraded: summary.freshness.degraded,
      source: "liff",
    },
  });

  return NextResponse.json(summary);
}
