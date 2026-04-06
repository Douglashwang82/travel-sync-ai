import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));

import { createAdminClient } from "@/lib/db";
import {
  createItem,
  updateItem,
  deleteItem,
  startVote,
  confirmItem,
  reopenItem,
  getActiveTrip,
} from "@/services/trip-state";

const TRIP_ID = "trip-001";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trip_items: [],
    trips: [{ id: TRIP_ID, group_id: "group-001", status: "active", destination_name: "Tokyo" }],
    ...extra,
  });
}

beforeEach(() => {
  resetIdCounter();
});

// ── createItem ────────────────────────────────────────────────────────────────

describe("createItem", () => {
  it("creates a new todo item and returns it", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({ tripId: TRIP_ID, title: "Book hotel in Tokyo" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.title).toBe("Book hotel in Tokyo");
    expect(result.item.stage).toBe("todo");
    expect(result.item.trip_id).toBe(TRIP_ID);
  });

  it("defaults item_type to 'other'", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({ tripId: TRIP_ID, title: "Miscellaneous item" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_type).toBe("other");
  });

  it("respects explicit item_type", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({ tripId: TRIP_ID, title: "Park Hyatt", itemType: "hotel" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_type).toBe("hotel");
  });

  it("returns DB_ERROR when insert fails", async () => {
    const db = createMockDb({}, { trip_items: { message: "connection error" } });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({ tripId: TRIP_ID, title: "Should fail" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DB_ERROR");
  });
});

// ── updateItem ────────────────────────────────────────────────────────────────

describe("updateItem", () => {
  it("updates the title of an existing item", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-001", trip_id: TRIP_ID, title: "Old title", stage: "todo", item_type: "other" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await updateItem("item-001", { title: "New title" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.title).toBe("New title");
  });

  it("updates itemType correctly", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-002", trip_id: TRIP_ID, title: "Dinner", stage: "todo", item_type: "other" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await updateItem("item-002", { itemType: "restaurant" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_type).toBe("restaurant");
  });
});

// ── deleteItem ────────────────────────────────────────────────────────────────

describe("deleteItem", () => {
  it("hard-deletes an item from the board", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-del", trip_id: TRIP_ID, title: "To delete", stage: "todo" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await deleteItem("item-del");
    expect(result.ok).toBe(true);

    const rows = db._tables.get("trip_items") ?? [];
    expect(rows.find((r) => r.id === "item-del")).toBeUndefined();
  });
});

// ── startVote ─────────────────────────────────────────────────────────────────

describe("startVote", () => {
  it("moves a todo item to pending", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-vote", trip_id: TRIP_ID, title: "Hotel vote", stage: "todo" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const deadline = new Date(Date.now() + 86400_000).toISOString();
    const result = await startVote("item-vote", deadline);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("pending");
    expect(result.item.deadline_at).toBe(deadline);
  });

  it("returns NOT_FOUND for a missing item", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await startVote("nonexistent", new Date().toISOString());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_TRANSITION when item is already pending", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-pending", stage: "pending", trip_id: TRIP_ID, title: "Vote in progress" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await startVote("item-pending", new Date().toISOString());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_TRANSITION");
  });
});

// ── confirmItem ───────────────────────────────────────────────────────────────

describe("confirmItem", () => {
  it("confirms a pending item with the winning option", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-confirm", stage: "pending", trip_id: TRIP_ID, title: "Hotel" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await confirmItem("item-confirm", "option-win");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("confirmed");
    expect(result.item.confirmed_option_id).toBe("option-win");
    expect(result.item.deadline_at).toBeNull();
  });

  it("returns ALREADY_CONFIRMED for already-confirmed item (atomic race guard)", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-already", stage: "confirmed", trip_id: TRIP_ID, title: "Done" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await confirmItem("item-already", "opt-x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ALREADY_CONFIRMED");
  });

  it("also confirms a todo item (no stage guard)", async () => {
    const db = makeDb({
      trip_items: [{ id: "item-todo", stage: "todo", trip_id: TRIP_ID, title: "Manual confirm" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await confirmItem("item-todo", "opt-y");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("confirmed");
  });
});

// ── reopenItem ────────────────────────────────────────────────────────────────

describe("reopenItem", () => {
  it("reopens a confirmed item back to todo", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "item-reopen",
          stage: "confirmed",
          confirmed_option_id: "opt-old",
          deadline_at: "2026-01-01",
          trip_id: TRIP_ID,
          title: "Hotel",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await reopenItem("item-reopen");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("todo");
    expect(result.item.confirmed_option_id).toBeNull();
    expect(result.item.deadline_at).toBeNull();
  });

  it("resets tie_extension_count to 0 on reopen", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "item-tied",
          stage: "pending",
          confirmed_option_id: null,
          deadline_at: "2026-04-06T00:00:00Z",
          tie_extension_count: 2,
          trip_id: TRIP_ID,
          title: "Hotel",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await reopenItem("item-tied");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.tie_extension_count).toBe(0);
    expect(result.item.stage).toBe("todo");
  });
});

// ── getActiveTrip ─────────────────────────────────────────────────────────────

describe("getActiveTrip", () => {
  it("returns the active trip for a group", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const trip = await getActiveTrip("group-001");
    expect(trip).not.toBeNull();
    expect(trip?.id).toBe(TRIP_ID);
  });

  it("returns null when no active trip exists", async () => {
    const db = createMockDb({ trips: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const trip = await getActiveTrip("group-no-trip");
    expect(trip).toBeNull();
  });
});
