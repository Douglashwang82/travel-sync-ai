import { createAdminClient } from "@/lib/db";
import {
  findDestinationPlace,
  getPlaceDetails,
  getTimeZoneForCoordinates,
} from "@/services/decisions/places";

export async function enrichTripDestinationMetadata(
  tripId: string,
  destinationName: string,
  destinationPlaceId?: string | null
): Promise<void> {
  const db = createAdminClient();

  let resolvedPlaceId = destinationPlaceId ?? null;
  if (!resolvedPlaceId) {
    const candidate = await findDestinationPlace(destinationName);
    resolvedPlaceId = candidate?.placeId ?? null;
  }

  if (!resolvedPlaceId) {
    return;
  }

  const details = await getPlaceDetails(resolvedPlaceId);
  if (!details) {
    return;
  }

  const timeZone =
    details.lat != null && details.lng != null
      ? await getTimeZoneForCoordinates(details.lat, details.lng)
      : null;

  await db
    .from("trips")
    .update(buildTripDestinationMetadataPatch(details, timeZone?.timeZoneId ?? null))
    .eq("id", tripId);
}

export function buildTripDestinationMetadataPatch(
  details: {
    placeId: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    googleMapsUrl: string | null;
    photoName: string | null;
  },
  destinationTimeZone: string | null
): Record<string, unknown> {
  return {
    destination_place_id: details.placeId,
    destination_formatted_address: details.address,
    destination_lat: details.lat,
    destination_lng: details.lng,
    destination_google_maps_url: details.googleMapsUrl,
    destination_photo_name: details.photoName,
    destination_timezone: destinationTimeZone,
    destination_source_last_synced_at: new Date().toISOString(),
  };
}
