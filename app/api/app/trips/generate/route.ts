import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";

// POST /api/app/trips/generate
//
// Receives completed survey answers from the web wizard
// (/app/trips/new), calls services/trip-generation#generateTemplateFromSurvey,
// then services/templates#forkTemplate, and returns the new tripId so the
// client can redirect to /app/trips/[tripId].
//
// Stub until trip-generation logic lands. See design/trip-generation.md.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    { error: "not_implemented", message: "Trip generation is in design." },
    { status: 501 }
  );
}
