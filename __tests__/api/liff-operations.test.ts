import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/liff-server", () => ({
  requireTripMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Utest",
    membership: { groupId: "group-test", role: "member" },
  }),
}));
vi.mock("@/services/operations", () => ({
  getOperationsSummary: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({
  track: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "@/app/api/liff/operations/route";
import { getOperationsSummary } from "@/services/operations";
import { track } from "@/lib/analytics";

const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeRequest(tripId?: string) {
  const url = tripId
    ? `http://localhost/api/liff/operations?tripId=${tripId}`
    : "http://localhost/api/liff/operations";
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/liff/operations", () => {
  it("returns 400 when tripId is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when summary is not found", async () => {
    vi.mocked(getOperationsSummary).mockResolvedValueOnce(null);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns confirmedLinks with googleMapsUrl and bookingUrl", async () => {
    vi.mocked(getOperationsSummary).mockResolvedValueOnce({
      tripId: TRIP_ID,
      destinationName: "Tokyo",
      destinationAnchor: {
        placeId: "place-123",
        formattedAddress: "Tokyo, Japan",
        googleMapsUrl: "https://maps.google.com/?cid=123",
        lat: 35.6762,
        lng: 139.6503,
        timeZone: "Asia/Tokyo",
      },
      phase: "active",
      headline: "Active mode for Tokyo: 2 next actions, 1 active risk.",
      nextActions: ["Use /brief for a daily run-of-day summary."],
      activeRisks: ["Operations data is partial."],
      transportStatus: ["Flight committed: JL12"],
      confirmedToday: ["Park Hyatt Tokyo"],
      readiness: {
        completionPercent: 60,
        confidenceScore: 80,
        blockerCount: 1,
      },
      confirmedLinks: [
        {
          itemId: "item-confirmed-1",
          title: "Park Hyatt Tokyo",
          itemType: "hotel",
          googleMapsUrl: "https://maps.google.com/?cid=123",
          bookingUrl: "https://booking.example/hotel",
        },
      ],
      sourceOfTruth: ["Accommodation: Park Hyatt Tokyo"],
      freshness: {
        generatedAt: "2026-04-13T12:00:00.000Z",
        degraded: false,
        notes: ["This view uses committed trip data only."],
      },
    });

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.confirmedLinks).toHaveLength(1);
    expect(body.confirmedLinks[0].googleMapsUrl).toBe("https://maps.google.com/?cid=123");
    expect(body.confirmedLinks[0].bookingUrl).toBe("https://booking.example/hotel");
    expect(track).toHaveBeenCalledWith(
      "ops_view_opened",
      expect.objectContaining({
        properties: expect.objectContaining({
          trip_id: TRIP_ID,
          source: "liff",
        }),
      })
    );
  });
});
