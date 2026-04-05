import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/gemini");

import { createAdminClient } from "@/lib/db";
import { generateJson } from "@/lib/gemini";
import { parseMessage } from "@/services/parsing";

const GROUP_ID = "group-parse-001";
const TRIP_ID = "trip-parse-001";
const EVENT_ID = "event-parse-001";

function makeDb(overrides: Record<string, unknown[]> = {}) {
  return createMockDb({
    group_members: [{ id: "m1", group_id: GROUP_ID, line_user_id: "user-001", optout_at: null }],
    trips: [
      {
        id: TRIP_ID,
        group_id: GROUP_ID,
        status: "active",
        destination_name: "Tokyo",
        start_date: "2026-05-01",
        end_date: "2026-05-10",
      },
    ],
    trip_items: [],
    parsed_entities: [],
    ...overrides,
  });
}

function mockGeminiResponse(response: object) {
  vi.mocked(generateJson).mockResolvedValue(response);
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── Irrelevant messages ───────────────────────────────────────────────────────

describe("parseMessage — irrelevant messages", () => {
  it("short irrelevant message — exits before LLM call", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await parseMessage({ messageText: "ok", groupId: GROUP_ID, lineEventId: EVENT_ID });

    expect(generateJson).not.toHaveBeenCalled();
    expect(db._tables.get("trip_items")?.length).toBe(0);
  });

  it("greeting message — exits before LLM call", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await parseMessage({ messageText: "晚安", groupId: GROUP_ID, lineEventId: EVENT_ID });

    expect(generateJson).not.toHaveBeenCalled();
  });
});

// ── Opted-out users ───────────────────────────────────────────────────────────

describe("parseMessage — opt-out", () => {
  it("skips parsing for opted-out user", async () => {
    const db = makeDb({
      group_members: [
        { id: "m1", group_id: GROUP_ID, line_user_id: "user-optout", optout_at: "2026-01-01" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await parseMessage({
      messageText: "Let's book the Park Hyatt hotel",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
      lineUserId: "user-optout",
    });

    expect(generateJson).not.toHaveBeenCalled();
  });

  it("parses normally when user has not opted out", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({
      relevant: false,
      entities: [],
      suggestedActions: [],
      conflicts: [],
    });

    await parseMessage({
      messageText: "Let's book a hotel in Tokyo",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
      lineUserId: "user-001",
    });

    expect(generateJson).toHaveBeenCalled();
  });
});

// ── No active trip ────────────────────────────────────────────────────────────

describe("parseMessage — no active trip", () => {
  it("skips LLM call when no active trip exists", async () => {
    const db = createMockDb({
      group_members: [{ id: "m1", group_id: GROUP_ID, line_user_id: "user-001", optout_at: null }],
      trips: [],
      trip_items: [],
      parsed_entities: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await parseMessage({ messageText: "I want to book a hotel", groupId: GROUP_ID, lineEventId: EVENT_ID });

    expect(generateJson).not.toHaveBeenCalled();
  });
});

// ── Successful extraction ─────────────────────────────────────────────────────

describe("parseMessage — successful entity extraction", () => {
  it("creates a todo item when AI suggests create_todo_item", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({
      relevant: true,
      entities: [
        { type: "hotel", canonicalValue: "Park Hyatt Tokyo", displayValue: "Park Hyatt", confidence: 0.95, attributes: {} },
      ],
      suggestedActions: [
        { action: "create_todo_item", itemTitle: "Book Park Hyatt Tokyo", itemType: "hotel" },
      ],
      conflicts: [],
    });

    await parseMessage({
      messageText: "Let's stay at Park Hyatt hotel",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
    });

    const items = db._tables.get("trip_items") ?? [];
    expect(items.some((i) => i.title === "Book Park Hyatt Tokyo")).toBe(true);
    expect(items[0]?.source).toBe("ai");
    expect(items[0]?.item_type).toBe("hotel");
  });

  it("persists extracted entities to parsed_entities table", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({
      relevant: true,
      entities: [
        { type: "date_range", canonicalValue: "2026-05-01/2026-05-10", displayValue: "5月1日到10日", confidence: 0.9, attributes: {} },
      ],
      suggestedActions: [],
      conflicts: [],
    });

    await parseMessage({
      messageText: "我們5月1日到10日出發",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
    });

    const entities = db._tables.get("parsed_entities") ?? [];
    expect(entities).toHaveLength(1);
    expect(entities[0].entity_type).toBe("date_range");
    expect(entities[0].canonical_value).toBe("2026-05-01/2026-05-10");
  });

  it("does not duplicate a todo item with the same title", async () => {
    const db = makeDb({
      trip_items: [
        { id: "existing-item", trip_id: TRIP_ID, title: "Book Park Hyatt Tokyo", stage: "todo", item_type: "hotel", source: "manual" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({
      relevant: true,
      entities: [
        { type: "hotel", canonicalValue: "Park Hyatt Tokyo", displayValue: "Park Hyatt", confidence: 0.9, attributes: {} },
      ],
      suggestedActions: [
        { action: "create_todo_item", itemTitle: "Book Park Hyatt Tokyo", itemType: "hotel" },
      ],
      conflicts: [],
    });

    await parseMessage({
      messageText: "Book Park Hyatt Tokyo please",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
    });

    const items = db._tables.get("trip_items") ?? [];
    const hotelItems = items.filter((i) => i.title === "Book Park Hyatt Tokyo");
    expect(hotelItems).toHaveLength(1); // No duplicate
  });

  it("filters out low-confidence entities (< 0.6)", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({
      relevant: true,
      entities: [
        { type: "hotel", canonicalValue: "Maybe Hotel", displayValue: "maybe", confidence: 0.4, attributes: {} },
      ],
      suggestedActions: [],
      conflicts: [],
    });

    await parseMessage({
      messageText: "maybe we should stay somewhere nice",
      groupId: GROUP_ID,
      lineEventId: EVENT_ID,
    });

    // Low confidence entity filtered → treated as irrelevant → no entities persisted
    const entities = db._tables.get("parsed_entities") ?? [];
    expect(entities).toHaveLength(0);
  });
});

// ── LLM failure resilience ────────────────────────────────────────────────────

describe("parseMessage — LLM failure handling", () => {
  it("does not throw when Gemini throws", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateJson).mockRejectedValue(new Error("Gemini network error"));

    // Should resolve without throwing
    await expect(
      parseMessage({ messageText: "Let's book a hotel", groupId: GROUP_ID, lineEventId: EVENT_ID })
    ).resolves.toBeUndefined();
  });

  it("does not create items when Gemini returns invalid JSON shape", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    mockGeminiResponse({ malformed: true }); // Doesn't match ParseResultSchema

    await parseMessage({ messageText: "Let's book a hotel", groupId: GROUP_ID, lineEventId: EVENT_ID });

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(0);
  });
});
