import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";

interface GoogleSuggestion {
  placePrediction?: {
    placeId?: string;
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    text?: { text?: string };
  };
}

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string | null;
}

/**
 * GET /api/app/places/autocomplete?q=...&lat=...&lng=...
 *
 * Server-side proxy for Google Places Autocomplete (New). Keeps the API key
 * out of the browser. Logged-in app users only — this is rate-limited by
 * Google upstream and returns at most ~5 suggestions per call.
 *
 * Optional lat/lng bias the results toward a circle around the trip
 * destination so users searching "Marriott" near Tokyo don't get NYC results.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Places API not configured", code: "NO_API_KEY" },
      { status: 500 }
    );
  }

  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const hasBias = Number.isFinite(lat) && Number.isFinite(lng);

  const body: Record<string, unknown> = {
    input: query,
    languageCode: "zh-TW",
  };
  if (hasBias) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50000,
      },
    };
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[places.autocomplete] upstream error", res.status, await res.text());
      return NextResponse.json(
        { error: "Upstream Places error", code: "UPSTREAM_ERROR" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { suggestions?: GoogleSuggestion[] };
    const suggestions: PlaceAutocompleteSuggestion[] = (data.suggestions ?? [])
      .map((s) => {
        const p = s.placePrediction;
        if (!p?.placeId) return null;
        const primary =
          p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
        const secondary = p.structuredFormat?.secondaryText?.text ?? null;
        return { placeId: p.placeId, primaryText: primary, secondaryText: secondary };
      })
      .filter((x): x is PlaceAutocompleteSuggestion => x !== null);

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("[places.autocomplete] threw", err);
    return NextResponse.json(
      { error: "Network error", code: "NETWORK_ERROR" },
      { status: 502 }
    );
  }
}
