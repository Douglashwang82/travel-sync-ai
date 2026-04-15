import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationsSummary } from "@/services/operations";

describe("buildOperationsSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("derives trip phase using the destination timezone when available", () => {
    vi.setSystemTime(new Date("2026-04-12T18:30:00.000Z"));

    const summary = buildOperationsSummary(
      {
        id: "trip-1",
        destination_name: "Tokyo",
        destination_place_id: "place-tokyo",
        destination_formatted_address: "Tokyo, Japan",
        destination_google_maps_url: "https://maps.google.com/?cid=123",
        destination_lat: 35.6762,
        destination_lng: 139.6503,
        destination_timezone: "Asia/Tokyo",
        start_date: "2026-04-13",
        end_date: "2026-04-20",
        status: "active",
      },
      [],
      null
    );

    expect(summary.phase).toBe("departure");
    expect(summary.destinationAnchor.timeZone).toBe("Asia/Tokyo");
    expect(summary.destinationAnchor.googleMapsUrl).toBe("https://maps.google.com/?cid=123");
  });

  it("falls back to UTC-style date handling when timezone is unavailable", () => {
    vi.setSystemTime(new Date("2026-04-12T18:30:00.000Z"));

    const summary = buildOperationsSummary(
      {
        id: "trip-2",
        destination_name: "Tokyo",
        destination_place_id: null,
        destination_formatted_address: null,
        destination_google_maps_url: null,
        destination_lat: null,
        destination_lng: null,
        destination_timezone: null,
        start_date: "2026-04-13",
        end_date: "2026-04-20",
        status: "active",
      },
      [],
      null
    );

    expect(summary.phase).toBe("countdown");
  });
});
