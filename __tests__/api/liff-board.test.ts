import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

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

  it("returns board data grouped by stage (decision items only)", async () => {
    const db = createMockDb({
      trips: [
        {
          id: TRIP_ID,
          destination_name: "Tokyo",
          start_date: "2026-05-01",
          end_date: "2026-05-10",
          status: "active",
        },
      ],
      trip_items: [
        { id: "item-todo-1", trip_id: TRIP_ID, title: "Book flight", stage: "todo", item_type: "flight", item_kind: "decision" },
        { id: "item-todo-2", trip_id: TRIP_ID, title: "Buy insurance", stage: "todo", item_type: "insurance", item_kind: "decision" },
        { id: "item-pending-1", trip_id: TRIP_ID, title: "Choose hotel", stage: "pending", item_type: "hotel", item_kind: "decision" },
        { id: "item-confirmed-1", trip_id: TRIP_ID, title: "Reserve restaurant", stage: "confirmed", item_type: "restaurant", item_kind: "decision" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.trip.id).toBe(TRIP_ID);
    expect(body.trip.destination_name).toBe("Tokyo");

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
    expect(body.knowledge).toEqual([]);
  });

  it("separates knowledge items from decision items", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, destination_name: "Kyoto", status: "active" }],
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Nishiki Market", stage: "todo", item_type: "activity", item_kind: "knowledge" },
        { id: "k2", trip_id: TRIP_ID, title: "Fushimi Inari", stage: "todo", item_type: "activity", item_kind: "knowledge" },
        { id: "d1", trip_id: TRIP_ID, title: "Book ryokan", stage: "todo", item_type: "hotel", item_kind: "decision" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.knowledge).toHaveLength(2);
    expect(body.todo).toHaveLength(1);
    expect(body.knowledge.map((i: { title: string }) => i.title)).toContain("Nishiki Market");
    expect(body.knowledge.map((i: { title: string }) => i.title)).toContain("Fushimi Inari");
    expect(body.todo[0].title).toBe("Book ryokan");
  });

  it("knowledge items do NOT appear in todo/pending/confirmed", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, destination_name: "Osaka", status: "active" }],
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Dotonbori", stage: "todo", item_type: "activity", item_kind: "knowledge" },
        { id: "k2", trip_id: TRIP_ID, title: "Kuromon Market", stage: "todo", item_type: "restaurant", item_kind: "knowledge" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    const body = await res.json();

    expect(body.todo).toHaveLength(0);
    expect(body.pending).toHaveLength(0);
    expect(body.confirmed).toHaveLength(0);
    expect(body.knowledge).toHaveLength(2);
  });

  it("response includes knowledge array even when empty", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, destination_name: "Tokyo", status: "active" }],
      trip_items: [
        { id: "d1", trip_id: TRIP_ID, title: "Book hotel", stage: "todo", item_type: "hotel", item_kind: "decision" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest(TRIP_ID));
    const body = await res.json();

    expect(body.knowledge).toBeDefined();
    expect(body.knowledge).toEqual([]);
  });
});
