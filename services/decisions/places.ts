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

export interface PlaceDetails {
  name: string;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  photoUrl: string | null;
  photoName: string | null;
  placeId: string;
  bookingUrl: string | null;
  googleMapsUrl: string | null;
  lat: number | null;
  lng: number | null;
}

export type PlacesErrorKind =
  | "no_results"
  | "network_error"
  | null;

export interface SearchPlacesResult {
  candidates: PlaceCandidate[];
  errorKind: PlacesErrorKind;
}

export interface PlaceTimeZone {
  timeZoneId: string;
}

const ITEM_TYPE_QUERY: Partial<Record<ItemType, string>> = {
  hotel: "hotels",
  restaurant: "restaurants",
  activity: "tourist attractions",
  transport: "transportation",
};

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress";
const DETAILS_FIELDS =
  "id,displayName,formattedAddress,rating,priceLevel,photos,googleMapsUri,location";

export async function searchPlaces(
  destination: string,
  itemType: ItemType,
  maxResults = 5
): Promise<SearchPlacesResult> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    console.warn("[places] no Places or unified Maps API key set; returning empty");
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
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": SEARCH_FIELDS,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[places] API error (attempt ${attempt})`, res.status, await res.text());
        lastError = new Error(`HTTP ${res.status}`);
        return { candidates: [], errorKind: "network_error" };
      }

      const data = (await res.json()) as { places?: GooglePlace[] };
      const places = data.places ?? [];

      if (places.length === 0) {
        return { candidates: [], errorKind: "no_results" };
      }

      return {
        candidates: places.slice(0, maxResults).map(normalizePlaceCandidate),
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

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    console.warn("[places] getPlaceDetails skipped because no Places or unified Maps API key is set");
    return null;
  }

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": DETAILS_FIELDS,
      },
    });

    if (!res.ok) {
      console.error("[places] details API error", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as GooglePlace;
    const photoRef = data.photos?.[0]?.name;

    return {
      name: data.displayName?.text ?? "Unknown",
      address: data.formattedAddress ?? null,
      rating: data.rating ?? null,
      priceLevel: normalizePriceLevel(data.priceLevel),
      photoUrl: photoRef ? buildPhotoUrl(photoRef) : null,
      photoName: photoRef ?? null,
      placeId: data.id,
      bookingUrl: null,
      googleMapsUrl: data.googleMapsUri ?? null,
      lat: data.location?.latitude ?? null,
      lng: data.location?.longitude ?? null,
    };
  } catch (err) {
    console.error("[places] getPlaceDetails threw", err);
    return null;
  }
}

export async function findDestinationPlace(destination: string): Promise<PlaceCandidate | null> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    console.warn("[places] findDestinationPlace skipped because no Places or unified Maps API key is set");
    return null;
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": SEARCH_FIELDS,
      },
      body: JSON.stringify({
        textQuery: destination,
        maxResultCount: 1,
        languageCode: "en",
      }),
    });

    if (!res.ok) {
      console.error("[places] destination search API error", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as { places?: GooglePlace[] };
    const place = data.places?.[0];
    return place ? normalizePlaceCandidate(place) : null;
  } catch (err) {
    console.error("[places] findDestinationPlace threw", err);
    return null;
  }
}

export async function getTimeZoneForCoordinates(
  lat: number,
  lng: number,
  timestamp = Math.floor(Date.now() / 1000)
): Promise<PlaceTimeZone | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    console.warn("[places] getTimeZoneForCoordinates skipped because no Maps API key is set");
    return null;
  }

  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    timestamp: String(timestamp),
    key: apiKey,
  });

  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?${params.toString()}`);
    if (!res.ok) {
      console.error("[places] timezone API error", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      status?: string;
      timeZoneId?: string;
      errorMessage?: string;
    };

    if (data.status !== "OK" || !data.timeZoneId) {
      console.error("[places] timezone API returned non-OK status", data.status, data.errorMessage);
      return null;
    }

    return { timeZoneId: data.timeZoneId };
  } catch (err) {
    console.error("[places] getTimeZoneForCoordinates threw", err);
    return null;
  }
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  priceLevel?: string;
  photos?: { name: string }[];
  googleMapsUri?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

function normalizePlaceCandidate(place: GooglePlace): PlaceCandidate {
  return {
    name: place.displayName?.text ?? "Unknown",
    address: place.formattedAddress ?? null,
    rating: null,
    priceLevel: null,
    photoUrl: null,
    placeId: place.id,
    bookingUrl: null,
  };
}

function buildPhotoUrl(photoName: string): string {
  const apiKey = getPlacesApiKey();
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

function getPlacesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_SERVER_API_KEY;
}

function getMapsApiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
}
