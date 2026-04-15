import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/liff-server", () => ({
  requireTripMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Utest",
    membership: { groupId: "group-test", role: "organizer" },
  }),
}));

import { createAdminClient } from "@/lib/db";
import { GET } from "@/app/api/liff/board/route";

const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeRequest(tripId?: string) {
  const url = tripId
    ? `http://localhost/api/liff/board?tripId=${tripId}`
    : "http://localhost/api/liff/board";
  return new NextRequest(url);
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

describe("GET /api/liff/board", () => {
  it("returns 400 when tripId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when tripId is not a valid UUID", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when trip is not found", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns board data grouped by stage", async () => {
    const db = createMockDb({
      trips: [
        {
          id: TRIP_ID,
          destination_name: "Tokyo",
          destination_place_id: "place-tokyo",
          destination_formatted_address: "Tokyo, Japan",
          destination_google_maps_url: "https://maps.google.com/?cid=123",
          destination_lat: 35.6762,
          destination_lng: 139.6503,
          destination_timezone: "Asia/Tokyo",
          destination_source_last_synced_at: "2026-04-13T18:00:00.000Z",
          start_date: "2026-05-01",
          end_date: "2026-05-10",
          status: "active",
        },
      ],
      trip_items: [
        { id: "item-todo-1", trip_id: TRIP_ID, title: "Book flight", stage: "todo", item_type: "flight" },
        { id: "item-todo-2", trip_id: TRIP_ID, title: "Buy insurance", stage: "todo", item_type: "insurance" },
        { id: "item-pending-1", trip_id: TRIP_ID, title: "Choose hotel", stage: "pending", item_type: "hotel" },
        { id: "item-confirmed-1", trip_id: TRIP_ID, title: "Reserve restaurant", stage: "confirmed", item_type: "restaurant" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.trip.id).toBe(TRIP_ID);
    expect(body.trip.destination_name).toBe("Tokyo");
    expect(body.trip.destination_place_id).toBe("place-tokyo");
    expect(body.trip.destination_formatted_address).toBe("Tokyo, Japan");
    expect(body.trip.destination_google_maps_url).toBe("https://maps.google.com/?cid=123");
    expect(body.trip.destination_lat).toBe(35.6762);
    expect(body.trip.destination_lng).toBe(139.6503);
    expect(body.trip.destination_timezone).toBe("Asia/Tokyo");

    expect(body.todo).toHaveLength(2);
    expect(body.pending).toHaveLength(1);
    expect(body.confirmed).toHaveLength(1);

    expect(body.todo.map((i: { title: string }) => i.title)).toContain("Book flight");
    expect(body.pending[0].title).toBe("Choose hotel");
    expect(body.confirmed[0].title).toBe("Reserve restaurant");
  });

  it("returns empty board when trip has no items", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, destination_name: "Osaka", status: "active" }],
      trip_items: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.todo).toEqual([]);
    expect(body.pending).toEqual([]);
    expect(body.confirmed).toEqual([]);
    expect(body.trip.destination_place_id ?? null).toBeNull();
  });
});
