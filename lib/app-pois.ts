// Shared types for the user-scoped "My Places" / saved-POIs feature.
// The DB table is `user_saved_pois` (see the 20260529 migration); the web app
// builds the list from the map explorer and manages it on /app/pois.

export const SAVED_POI_TYPES = [
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "other",
] as const;

export type SavedPoiType = (typeof SAVED_POI_TYPES)[number];

export type SavedPoiSource = "curated" | "google" | "manual" | "explorer";

export interface SavedPoi {
  id: string;
  placeId: string | null;
  name: string;
  itemType: SavedPoiType;
  address: string | null;
  lat: number;
  lng: number;
  notes: string | null;
  source: string;
  destinationName: string | null;
  googleMapsUrl: string | null;
  createdAt: string;
}

export function coerceSavedPoiType(raw: string | null | undefined): SavedPoiType {
  return (SAVED_POI_TYPES as readonly string[]).includes(raw ?? "")
    ? (raw as SavedPoiType)
    : "other";
}

/** Map a DB row (snake_case) into the API/UI `SavedPoi` shape. */
export function rowToSavedPoi(row: Record<string, unknown>): SavedPoi {
  return {
    id: row.id as string,
    placeId: (row.place_id as string | null) ?? null,
    name: (row.name as string) ?? "",
    itemType: coerceSavedPoiType(row.item_type as string | null),
    address: (row.address as string | null) ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    notes: (row.notes as string | null) ?? null,
    source: (row.source as string) ?? "manual",
    destinationName: (row.destination_name as string | null) ?? null,
    googleMapsUrl: (row.google_maps_url as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}
