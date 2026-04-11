import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";
import { getReadinessSnapshot } from "@/services/readiness";

const ReadinessQuerySchema = z.object({
  tripId: z.string().uuid(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const parsed = ReadinessQuerySchema.safeParse({
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

  const snapshot = await getReadinessSnapshot(parsed.data.tripId);
  if (!snapshot) {
    return NextResponse.json<ApiError>(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json(snapshot);
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "not_implemented",
      feature: "readiness-mutations",
      message:
        "Readiness writes are not implemented yet. Current v1.2 readiness is read-only and committed-data-driven.",
    },
    { status: 501 }
  );
}
