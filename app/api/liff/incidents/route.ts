import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";
import { resolveIncident } from "@/services/incidents";

const IncidentBodySchema = z.object({
  tripId: z.string().uuid(),
  query: z.string().min(1).max(200),
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

  const parsed = IncidentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const auth = await requireTripMembership(req, parsed.data.tripId);
  if (!auth.ok) return auth.response;

  const resolution = resolveIncident(parsed.data.query);
  return NextResponse.json(resolution);
}
