/**
 * Tests the changed behaviour of `applyParseResult` when the AI suggests
 * `add_option` — instead of attaching an option to an existing decision item,
 * the place is now saved as a KNOWLEDGE item so the AI can use it for
 * recommendations and the group can promote it to a vote via /decide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { applyParseResult } from "@/services/parsing/item-generator";
import type { ParsedEntity, SuggestedAction } from "@/services/parsing/extractor";

const GROUP_ID = "group-opt-001";
const TRIP_ID = "trip-opt-001";
const EVENT_ID = "event-opt-001";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trips: [{ id: TRIP_ID, group_id: GROUP_ID, status: "active", destination_name: "Tokyo" }],
    trip_items: [],
    trip_item_options: [],
    parsed_entities: [],
    ...extra,
  });
}

const NO_ENTITIES: ParsedEntity[] = [];

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── add_option → knowledge item ───────────────────────────────────────────────

describe("applyParseResult — add_option creates knowledge item", () => {
  it("creates a knowledge item when AI suggests add_option", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "add_option", optionName: "Ramen Nagi Shinjuku", itemType: "restaurant" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Ramen Nagi Shinjuku");
    expect(items[0].item_kind).toBe("knowledge");
    expect(items[0].item_type).toBe("restaurant");
    expect(items[0].source).toBe("ai");
    expect(items[0].stage).toBe("todo");
  });

  it("does NOT create a trip_item_option row for add_option", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "add_option", optionName: "Park Hyatt Tokyo", itemType: "hotel" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const options = db._tables.get("trip_item_options") ?? [];
    expect(options).toHaveLength(0);
  });

  it("does not create a duplicate knowledge item for the same place", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "existing",
          trip_id: TRIP_ID,
          title: "Ramen Nagi Shinjuku",
          item_kind: "knowledge",
          item_type: "restaurant",
          stage: "todo",
          source: "ai",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "add_option", optionName: "Ramen Nagi Shinjuku", itemType: "restaurant" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    const matchingItems = items.filter((i) => i.title === "Ramen Nagi Shinjuku");
    expect(matchingItems).toHaveLength(1); // no duplicate
  });

  it("ignores add_option when optionName is missing", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // optionName is omitted — should be a no-op
    const actions: SuggestedAction[] = [{ action: "add_option", itemType: "restaurant" }];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(0);
  });

  it("ignores add_option when itemType is missing", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // itemType is omitted
    const actions: SuggestedAction[] = [{ action: "add_option", optionName: "Some Place" }];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(0);
  });

  it("creates multiple knowledge items for multiple add_option actions", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "add_option", optionName: "Ramen Nagi", itemType: "restaurant" },
      { action: "add_option", optionName: "Ichiran", itemType: "restaurant" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.item_kind === "knowledge")).toBe(true);
  });
});

// ── create_todo_item still creates decision items ─────────────────────────────

describe("applyParseResult — create_todo_item still creates decision items", () => {
  it("creates a decision item for create_todo_item action", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "create_todo_item", itemTitle: "Book travel insurance", itemType: "insurance" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Book travel insurance");
    expect(items[0].item_kind).toBe("decision");
    expect(items[0].item_type).toBe("insurance");
  });

  it("decision and knowledge items coexist from the same parse result", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "create_todo_item", itemTitle: "Book hotel", itemType: "hotel" },
      { action: "add_option", optionName: "Park Hyatt Tokyo", itemType: "hotel" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(2);

    const decisionItems = items.filter((i) => i.item_kind === "decision");
    const knowledgeItems = items.filter((i) => i.item_kind === "knowledge");
    expect(decisionItems).toHaveLength(1);
    expect(knowledgeItems).toHaveLength(1);

    expect(decisionItems[0].title).toBe("Book hotel");
    expect(knowledgeItems[0].title).toBe("Park Hyatt Tokyo");
  });

  it("does not duplicate a decision item with the same title", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "existing",
          trip_id: TRIP_ID,
          title: "Book hotel",
          item_kind: "decision",
          item_type: "hotel",
          stage: "todo",
          source: "ai",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "create_todo_item", itemTitle: "Book hotel", itemType: "hotel" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, NO_ENTITIES, actions);

    const items = db._tables.get("trip_items") ?? [];
    const hotelDecisions = items.filter((i) => i.title === "Book hotel");
    expect(hotelDecisions).toHaveLength(1);
  });
});
