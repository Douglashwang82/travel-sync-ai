import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));

import { createAdminClient } from "@/lib/db";
import { createItem, startVote } from "@/services/trip-state";

const TRIP_ID = "trip-kind-001";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trip_items: [],
    trips: [{ id: TRIP_ID, group_id: "group-001", status: "active", destination_name: "Tokyo" }],
    ...extra,
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── createItem — item_kind ─────────────────────────────────────────────────────

describe("createItem — item_kind", () => {
  it("defaults item_kind to 'decision' when not specified", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({ tripId: TRIP_ID, title: "Book hotel" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_kind).toBe("decision");
    expect(result.item.stage).toBe("todo");
  });

  it("persists item_kind 'knowledge' when specified", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({
      tripId: TRIP_ID,
      title: "Park Hyatt Tokyo",
      itemType: "hotel",
      itemKind: "knowledge",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_kind).toBe("knowledge");
    expect(result.item.item_type).toBe("hotel");
    expect(result.item.stage).toBe("todo");
  });

  it("persists item_kind 'decision' when explicitly specified", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({
      tripId: TRIP_ID,
      title: "Choose restaurant",
      itemType: "restaurant",
      itemKind: "decision",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.item_kind).toBe("decision");
  });

  it("knowledge item has stage 'todo' and no confirmed_option_id", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await createItem({
      tripId: TRIP_ID,
      title: "Dotonbori ramen street",
      itemKind: "knowledge",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("todo");
    expect(result.item.confirmed_option_id).toBeUndefined();
  });

  it("item_kind is stored in the database table", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await createItem({ tripId: TRIP_ID, title: "Some place", itemKind: "knowledge" });

    const rows = db._tables.get("trip_items") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].item_kind).toBe("knowledge");
  });
});

// ── startVote — knowledge item guard ──────────────────────────────────────────

describe("startVote — rejects knowledge items", () => {
  it("returns WRONG_KIND when item is a knowledge item", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "know-001",
          trip_id: TRIP_ID,
          title: "Park Hyatt Tokyo",
          stage: "todo",
          item_kind: "knowledge",
          item_type: "hotel",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await startVote("know-001", new Date().toISOString());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WRONG_KIND");
    expect(result.error).toMatch(/knowledge/i);
    expect(result.error).toMatch(/\/decide/i);
  });

  it("does not change the stage of a knowledge item after a rejected vote", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "know-002",
          trip_id: TRIP_ID,
          title: "Nishiki Market",
          stage: "todo",
          item_kind: "knowledge",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await startVote("know-002", new Date().toISOString());

    const rows = db._tables.get("trip_items") ?? [];
    const item = rows.find((r) => r.id === "know-002");
    expect(item?.stage).toBe("todo"); // unchanged
  });

  it("allows startVote on a decision item", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-001",
          trip_id: TRIP_ID,
          title: "Choose hotel",
          stage: "todo",
          item_kind: "decision",
          item_type: "hotel",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const deadline = new Date(Date.now() + 86400_000).toISOString();
    const result = await startVote("dec-001", deadline);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("pending");
  });

  it("returns NOT_FOUND before checking item_kind when item does not exist", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await startVote("ghost-item", new Date().toISOString());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });
});
