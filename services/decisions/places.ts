import type { ItemType } from "@/lib/types";

export interface PlaceCandidate {
  name: string;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  photoUrl: string | null;
  placeId: string;
  bookingUrl: string | null;
}

export type PlacesErrorKind =
  | "no_results"      // API responded OK but returned zero places
  | "network_error"   // fetch threw or returned non-2xx
  | null;             // success

export interface SearchPlacesResult {
  candidates: PlaceCandidate[];
  errorKind: PlacesErrorKind;
}

// Maps our item types to natural language search queries
const ITEM_TYPE_QUERY: Partial<Record<ItemType, string>> = {
  hotel: "hotels",
  restaurant: "restaurants",
  activity: "tourist attractions",
  transport: "transportation",
};

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Search for place candidates using Google Places Text Search API (v1).
 * Retries up to MAX_RETRIES times on network errors with linear backoff.
 * Returns a typed result so callers can distinguish "no results" from errors.
 */
export async function searchPlaces(
  destination: string,
  itemType: ItemType,
  maxResults = 5
): Promise<SearchPlacesResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[places] GOOGLE_PLACES_API_KEY not set — returning empty");
    return { candidates: [], errorKind: "network_error" };
  }

  const typeLabel = ITEM_TYPE_QUERY[itemType] ?? "places";
  const textQuery = `top ${typeLabel} in ${destination}`;

  const body = {
    textQuery,
    maxResultCount: maxResults,
    languageCode: "zh-TW",
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const res = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.photos",
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        console.error(`[places] API error (attempt ${attempt})`, res.status, await res.text());
        lastError = new Error(`HTTP ${res.status}`);
        // Non-2xx is unlikely to resolve on retry (bad key, quota) — stop immediately
        return { candidates: [], errorKind: "network_error" };
      }

      const data = (await res.json()) as { places?: GooglePlace[] };
      const places = data.places ?? [];

      if (places.length === 0) {
        return { candidates: [], errorKind: "no_results" };
      }

      return {
        candidates: places.slice(0, maxResults).map(normalizePlace),
        errorKind: null,
      };
    } catch (err) {
      lastError = err;
      console.error(`[places] fetch threw (attempt ${attempt}/${MAX_RETRIES + 1})`, err);

      if (attempt <= MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  console.error("[places] all retries exhausted", lastError);
  return { candidates: [], errorKind: "network_error" };
}

// ─── Google Places v1 response types ─────────────────────────────────────────

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  priceLevel?: string;
  photos?: { name: string }[];
}

function normalizePlace(place: GooglePlace): PlaceCandidate {
  const photoRef = place.photos?.[0]?.name;
  const photoUrl = photoRef ? buildPhotoUrl(photoRef) : null;

  return {
    name: place.displayName?.text ?? "Unknown",
    address: place.formattedAddress ?? null,
    rating: place.rating ?? null,
    priceLevel: normalizePriceLevel(place.priceLevel),
    photoUrl,
    placeId: place.id,
    bookingUrl: null, // OTA links wired in Phase 5
  };
}

function buildPhotoUrl(photoName: string): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY!;
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=600&key=${apiKey}`;
}

function normalizePriceLevel(raw: string | undefined): string | null {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return raw ? (map[raw] ?? null) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
