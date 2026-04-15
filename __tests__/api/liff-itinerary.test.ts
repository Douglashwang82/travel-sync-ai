import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/liff-server", () => ({
  requireTripMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Utest",
    membership: { groupId: "group-test", role: "member" },
  }),
}));

import { createAdminClient } from "@/lib/db";
import { GET } from "@/app/api/liff/itinerary/route";

const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeRequest(tripId?: string) {
  const url = tripId
    ? `http://localhost/api/liff/itinerary?tripId=${tripId}`
    : "http://localhost/api/liff/itinerary";
  return new NextRequest(url);
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

describe("GET /api/liff/itinerary", () => {
  it("returns 400 when tripId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when trip is not found", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns confirmed option links including google_maps_url", async () => {
    const db = createMockDb({
      trips: [
        {
          id: TRIP_ID,
          destination_name: "Tokyo",
          start_date: "2026-05-01",
          end_date: "2026-05-10",
        },
      ],
      trip_items: [
        {
          id: "item-confirmed-1",
          trip_id: TRIP_ID,
          title: "Park Hyatt Tokyo",
          item_type: "hotel",
          stage: "confirmed",
          deadline_at: "2026-05-02T15:00:00Z",
          confirmed_option_id: "opt-1",
          trip_item_options: {
            id: "opt-1",
            name: "Park Hyatt Tokyo",
            address: "3-7-1-2 Nishi Shinjuku",
            image_url: "https://example.com/photo.jpg",
            rating: 4.6,
            price_level: "$$$",
            booking_url: "https://booking.example/hotel",
            google_maps_url: "https://maps.google.com/?cid=123",
          },
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].confirmed_option.google_maps_url).toBe("https://maps.google.com/?cid=123");
    expect(body.items[0].confirmed_option.booking_url).toBe("https://booking.example/hotel");
  });
});
