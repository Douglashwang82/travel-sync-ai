import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/liff-server", () => ({
  requireOrganizerForTrip: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Uorganizer",
    membership: { groupId: "group-test", role: "organizer" },
  }),
  requireOrganizerForItem: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Uorganizer",
    membership: { groupId: "group-test", role: "organizer" },
  }),
}));

import { createAdminClient } from "@/lib/db";
import { POST } from "@/app/api/liff/items/route";

const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/liff/items", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("POST /api/liff/items — validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/liff/items", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_JSON");
  });

  it("returns 400 for unknown action", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ action: "unknown" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for create action with missing title", async () => {
    const db = createMockDb({ trips: [{ id: TRIP_ID, status: "active" }], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ action: "create", tripId: TRIP_ID }));
    expect(res.status).toBe(400);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

describe("POST /api/liff/items — create", () => {
  it("creates a new todo item and returns 201", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, status: "active" }],
      trip_items: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({
      action: "create",
      tripId: TRIP_ID,
      title: "Book ryokan in Kyoto",
      itemType: "hotel",
    }));

    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("Book ryokan in Kyoto");
    expect(item.stage).toBe("todo");
    expect(item.source).toBe("manual");
  });

  it("returns 404 when trip does not exist", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({
      action: "create",
      tripId: TRIP_ID,
      title: "Some item",
    }));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns 404 when trip is not active/draft", async () => {
    const db = createMockDb({
      trips: [{ id: TRIP_ID, status: "completed" }],
      trip_items: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({
      action: "create",
      tripId: TRIP_ID,
      title: "Should not create",
    }));

    expect(res.status).toBe(404);
  });
});

// ── Update ────────────────────────────────────────────────────────────────────

describe("POST /api/liff/items — update", () => {
  it("updates an existing item title", async () => {
    const db = createMockDb({
      trip_items: [{ id: ITEM_ID, trip_id: TRIP_ID, title: "Old title", stage: "todo", item_type: "other" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({
      action: "update",
      itemId: ITEM_ID,
      title: "New title",
    }));

    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item.title).toBe("New title");
  });
});

// ── Reopen ────────────────────────────────────────────────────────────────────

describe("POST /api/liff/items — reopen", () => {
  it("reopens a confirmed item to todo", async () => {
    const db = createMockDb({
      trip_items: [
        {
          id: ITEM_ID,
          trip_id: TRIP_ID,
          title: "Hotel",
          stage: "confirmed",
          confirmed_option_id: "opt-x",
          deadline_at: "2026-05-01",
          item_type: "hotel",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ action: "reopen", itemId: ITEM_ID }));

    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item.stage).toBe("todo");
    expect(item.confirmed_option_id).toBeNull();
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe("POST /api/liff/items — delete", () => {
  it("deletes an item and returns 204", async () => {
    const db = createMockDb({
      trip_items: [{ id: ITEM_ID, trip_id: TRIP_ID, title: "To remove", stage: "todo" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ action: "delete", itemId: ITEM_ID }));

    expect(res.status).toBe(204);
    const items = db._tables.get("trip_items") ?? [];
    expect(items.find((i) => i.id === ITEM_ID)).toBeUndefined();
  });
});
