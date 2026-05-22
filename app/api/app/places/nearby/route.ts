import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";

export interface NearbyPlace {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  primaryType: string | null;
  googleMapsUri: string | null;
}

export interface NearbyResponse {
  places: NearbyPlace[];
}

// Map our internal item types to Google Places (New) primary type filters.
const TYPE_TO_GOOGLE: Record<string, string[]> = {
  hotel: ["lodging"],
  restaurant: ["restaurant", "cafe"],
  activity: ["tourist_attraction", "museum", "park"],
  transport: ["transit_station", "train_station", "subway_station", "bus_station"],
};

const QuerySchema = z.object({
  q: z.string().max(120).optional(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  radius: z.number().positive().max(50000).optional(),
  category: z.enum(["hotel", "restaurant", "activity", "transport", "any"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.primaryType",
  "places.location",
  "places.googleMapsUri",
].join(",");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { q, lat, lng, radius, category, limit } = parsed.data;
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Places API not configured", code: "NO_API_KEY" },
      { status: 500 }
    );
  }

  const maxResults = limit ?? 12;
  const searchRadius = radius ?? 3000;
  const includedTypes =
    category && category !== "any" ? TYPE_TO_GOOGLE[category] : undefined;

  // When the user typed a query we use Text Search biased to the area;
  // otherwise we use Nearby Search to surface "what's around here".
  const useTextSearch = Boolean(q?.trim());
  const url = useTextSearch
    ? "https://places.googleapis.com/v1/places:searchText"
    : "https://places.googleapis.com/v1/places:searchNearby";

  const body: Record<string, unknown> = useTextSearch
    ? {
        textQuery: q!.trim(),
        maxResultCount: maxResults,
        languageCode: "zh-TW",
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: searchRadius,
          },
        },
        ...(includedTypes ? { includedType: includedTypes[0] } : {}),
      }
    : {
        maxResultCount: maxResults,
        languageCode: "zh-TW",
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: searchRadius,
          },
        },
        ...(includedTypes ? { includedTypes } : {}),
        rankPreference: "POPULARITY",
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[places.nearby] upstream error", res.status, await res.text());
      return NextResponse.json(
        { error: "Upstream Places error", code: "UPSTREAM_ERROR" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { places?: GooglePlace[] };
    const places: NearbyPlace[] = (data.places ?? [])
      .map((p): NearbyPlace | null => {
        if (
          !p.id ||
          p.location?.latitude == null ||
          p.location?.longitude == null
        ) {
          return null;
        }
        return {
          placeId: p.id,
          name: p.displayName?.text ?? "Unknown",
          address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
          lat: Number(p.location.latitude),
          lng: Number(p.location.longitude),
          rating: p.rating != null ? Number(p.rating) : null,
          userRatingCount:
            p.userRatingCount != null ? Number(p.userRatingCount) : null,
          priceLevel: p.priceLevel ?? null,
          primaryType: p.primaryType ?? null,
          googleMapsUri: p.googleMapsUri ?? null,
        };
      })
      .filter((x): x is NearbyPlace => x !== null);

    return NextResponse.json<NearbyResponse>({ places });
  } catch (err) {
    console.error("[places.nearby] threw", err);
    return NextResponse.json(
      { error: "Network error", code: "NETWORK_ERROR" },
      { status: 502 }
    );
  }
}
