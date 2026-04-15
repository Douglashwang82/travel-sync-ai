import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/services/decisions/places", () => ({
  findDestinationPlace: vi.fn(),
  getPlaceDetails: vi.fn(),
  getTimeZoneForCoordinates: vi.fn(),
}));

import { createAdminClient } from "@/lib/db";
import {
  findDestinationPlace,
  getPlaceDetails,
  getTimeZoneForCoordinates,
} from "@/services/decisions/places";
import {
  buildTripDestinationMetadataPatch,
  enrichTripDestinationMetadata,
} from "@/services/trips/destination";

describe("trip destination enrichment", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  it("builds a structured patch for trip destination metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T12:00:00.000Z"));

    expect(
      buildTripDestinationMetadataPatch(
        {
          placeId: "place-123",
          address: "Tokyo, Japan",
          lat: 35.6762,
          lng: 139.6503,
          googleMapsUrl: "https://maps.google.com/?cid=123",
          photoName: "places/place-123/photos/main",
        },
        "Asia/Tokyo"
      )
    ).toEqual({
      destination_place_id: "place-123",
      destination_formatted_address: "Tokyo, Japan",
      destination_lat: 35.6762,
      destination_lng: 139.6503,
      destination_google_maps_url: "https://maps.google.com/?cid=123",
      destination_photo_name: "places/place-123/photos/main",
      destination_timezone: "Asia/Tokyo",
      destination_source_last_synced_at: "2026-04-13T12:00:00.000Z",
    });

    vi.useRealTimers();
  });

  it("enriches trips from destination text when a place can be resolved", async () => {
    const db = createMockDb({
      trips: [{ id: "trip-1", destination_name: "Tokyo" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(findDestinationPlace).mockResolvedValueOnce({
      name: "Tokyo",
      address: "Tokyo, Japan",
      rating: null,
      priceLevel: null,
      photoUrl: null,
      placeId: "place-123",
      bookingUrl: null,
    });
    vi.mocked(getPlaceDetails).mockResolvedValueOnce({
      name: "Tokyo",
      address: "Tokyo, Japan",
      rating: null,
      priceLevel: null,
      photoUrl: null,
      photoName: "places/place-123/photos/main",
      placeId: "place-123",
      bookingUrl: null,
      googleMapsUrl: "https://maps.google.com/?cid=123",
      lat: 35.6762,
      lng: 139.6503,
    });
    vi.mocked(getTimeZoneForCoordinates).mockResolvedValueOnce({
      timeZoneId: "Asia/Tokyo",
    });

    await enrichTripDestinationMetadata("trip-1", "Tokyo");

    const trip = (db._tables.get("trips") ?? [])[0];
    expect(findDestinationPlace).toHaveBeenCalledWith("Tokyo");
    expect(getPlaceDetails).toHaveBeenCalledWith("place-123");
    expect(trip.destination_place_id).toBe("place-123");
    expect(trip.destination_formatted_address).toBe("Tokyo, Japan");
    expect(trip.destination_google_maps_url).toBe("https://maps.google.com/?cid=123");
    expect(trip.destination_lat).toBe(35.6762);
    expect(trip.destination_lng).toBe(139.6503);
    expect(trip.destination_timezone).toBe("Asia/Tokyo");
  });

  it("skips the text search when a destination place id already exists", async () => {
    const db = createMockDb({
      trips: [{ id: "trip-2", destination_name: "Osaka", destination_place_id: "place-osaka" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getPlaceDetails).mockResolvedValueOnce({
      name: "Osaka",
      address: "Osaka, Japan",
      rating: null,
      priceLevel: null,
      photoUrl: null,
      photoName: null,
      placeId: "place-osaka",
      bookingUrl: null,
      googleMapsUrl: "https://maps.google.com/?cid=456",
      lat: 34.6937,
      lng: 135.5023,
    });
    vi.mocked(getTimeZoneForCoordinates).mockResolvedValueOnce({
      timeZoneId: "Asia/Tokyo",
    });

    await enrichTripDestinationMetadata("trip-2", "Osaka", "place-osaka");

    expect(findDestinationPlace).not.toHaveBeenCalled();
    expect(getPlaceDetails).toHaveBeenCalledWith("place-osaka");
  });
});
