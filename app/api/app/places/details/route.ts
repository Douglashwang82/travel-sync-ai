import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { getPlaceDetails } from "@/services/decisions/places";

/**
 * GET /api/app/places/details?placeId=...
 *
 * Server-side proxy for Google Place Details. Returns the fields the picker
 * needs to fill an option row: name, address, lat, lng, googleMapsUrl,
 * photoUrl. Logged-in app users only.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get("placeId")?.trim();
  if (!placeId) {
    return NextResponse.json(
      { error: "placeId is required", code: "MISSING_PLACE_ID" },
      { status: 400 }
    );
  }

  const details = await getPlaceDetails(placeId);
  if (!details) {
    return NextResponse.json(
      { error: "Place not found or upstream error", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({ place: details });
}
