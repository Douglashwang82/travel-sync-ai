import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/gemini");

import { createAdminClient } from "@/lib/db";
import { generateText } from "@/lib/gemini";
import {
  getKnowledgeItems,
  buildDecisionFromKnowledge,
  generateTripPlan,
} from "@/services/knowledge";

const TRIP_ID = "trip-know-001";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trips: [
      {
        id: TRIP_ID,
        group_id: "group-001",
        status: "active",
        destination_name: "Tokyo",
        start_date: "2026-12-20",
        end_date: "2026-12-27",
        title: "Tokyo Winter Trip",
      },
    ],
    trip_items: [],
    trip_item_options: [],
    ...extra,
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── getKnowledgeItems ─────────────────────────────────────────────────────────

describe("getKnowledgeItems", () => {
  it("returns only knowledge items for a trip", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
        { id: "k2", trip_id: TRIP_ID, title: "Sushi Saito", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
        { id: "d1", trip_id: TRIP_ID, title: "Choose restaurant", item_kind: "decision", item_type: "restaurant", stage: "todo" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const items = await getKnowledgeItems(TRIP_ID);

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.item_kind === "knowledge")).toBe(true);
  });

  it("excludes decision items regardless of their stage", async () => {
    const db = makeDb({
      trip_items: [
        { id: "d1", trip_id: TRIP_ID, title: "Choose hotel", item_kind: "decision", item_type: "hotel", stage: "todo" },
        { id: "d2", trip_id: TRIP_ID, title: "Book flight", item_kind: "decision", item_type: "flight", stage: "pending" },
        { id: "d3", trip_id: TRIP_ID, title: "Book transport", item_kind: "decision", item_type: "transport", stage: "confirmed" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const knowledge = await getKnowledgeItems(TRIP_ID);

    expect(knowledge).toHaveLength(0);
  });

  it("filters by item_type when provided", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen place", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
        { id: "k2", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo" },
        { id: "k3", trip_id: TRIP_ID, title: "Sushi bar", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const restaurants = await getKnowledgeItems(TRIP_ID, "restaurant");

    expect(restaurants).toHaveLength(2);
    expect(restaurants.every((i) => i.item_type === "restaurant")).toBe(true);
  });

  it("filters by item_type excludes other types", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo" },
        { id: "k2", trip_id: TRIP_ID, title: "Ramen place", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const hotels = await getKnowledgeItems(TRIP_ID, "hotel");

    expect(hotels).toHaveLength(1);
    expect(hotels[0].title).toBe("Park Hyatt");
  });

  it("returns empty array when no knowledge items exist", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const items = await getKnowledgeItems(TRIP_ID);

    expect(items).toEqual([]);
  });

  it("returns TripItem objects with correct shape", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "k1",
          trip_id: TRIP_ID,
          title: "Shibuya Crossing",
          item_kind: "knowledge",
          item_type: "activity",
          stage: "todo",
          description: "Famous scramble crossing",
          source: "command",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const items = await getKnowledgeItems(TRIP_ID);

    expect(items[0].id).toBe("k1");
    expect(items[0].title).toBe("Shibuya Crossing");
    expect(items[0].description).toBe("Famous scramble crossing");
    expect(items[0].item_kind).toBe("knowledge");
  });
});

// ── buildDecisionFromKnowledge ─────────────────────────────────────────────────

describe("buildDecisionFromKnowledge", () => {
  it("returns null when no knowledge items exist for the type", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await buildDecisionFromKnowledge(TRIP_ID, "restaurant");

    expect(result).toBeNull();
  });

  it("creates a new decision item from knowledge items", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", source: "command", description: null },
        { id: "k2", trip_id: TRIP_ID, title: "Sushi Saito", item_kind: "knowledge", item_type: "restaurant", stage: "todo", source: "ai", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "restaurant");

    expect(decisionId).not.toBeNull();

    const items = db._tables.get("trip_items") ?? [];
    const decision = items.find((i) => i.id === decisionId);
    expect(decision).toBeDefined();
    expect(decision?.item_kind).toBe("decision");
    expect(decision?.item_type).toBe("restaurant");
    expect(decision?.stage).toBe("todo");
  });

  it("imports each knowledge item as a voteable option on the decision", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", source: "command", description: "Best ramen" },
        { id: "k2", trip_id: TRIP_ID, title: "Sushi Saito", item_kind: "knowledge", item_type: "restaurant", stage: "todo", source: "ai", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "restaurant");

    const options = db._tables.get("trip_item_options") ?? [];
    const decisionOptions = options.filter((o) => o.trip_item_id === decisionId);

    expect(decisionOptions).toHaveLength(2);
    expect(decisionOptions.some((o) => o.name === "Ramen Nagi")).toBe(true);
    expect(decisionOptions.some((o) => o.name === "Sushi Saito")).toBe(true);
  });

  it("sets options as 'manual' provider", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo", source: "command", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "hotel");

    const options = db._tables.get("trip_item_options") ?? [];
    const opt = options.find((o) => o.trip_item_id === decisionId);
    expect(opt?.provider).toBe("manual");
  });

  it("stores knowledge_item_id in option metadata for traceability", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo", source: "command", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "hotel");

    const options = db._tables.get("trip_item_options") ?? [];
    const opt = options.find((o) => o.trip_item_id === decisionId);
    expect((opt?.metadata_json as Record<string, unknown>)?.knowledge_item_id).toBe("k1");
  });

  it("uses custom title when provided", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo", source: "command", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "hotel", "Where should we stay?");

    const items = db._tables.get("trip_items") ?? [];
    const decision = items.find((i) => i.id === decisionId);
    expect(decision?.title).toBe("Where should we stay?");
  });

  it("defaults title to 'Choose [type]' when not provided", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Park Hyatt", item_kind: "knowledge", item_type: "hotel", stage: "todo", source: "command", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "hotel");

    const items = db._tables.get("trip_items") ?? [];
    const decision = items.find((i) => i.id === decisionId);
    expect(decision?.title).toBe("Choose hotel");
  });

  it("does not create a decision item when the source is 'system'", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen place", item_kind: "knowledge", item_type: "restaurant", stage: "todo", source: "ai", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "restaurant");

    const items = db._tables.get("trip_items") ?? [];
    const decisionItems = items.filter((i) => i.item_kind === "decision");
    expect(decisionItems).toHaveLength(1);
    expect(decisionId).not.toBeNull();
  });
});

// ── generateTripPlan ──────────────────────────────────────────────────────────

describe("generateTripPlan", () => {
  it("calls generateText and returns the AI-drafted plan", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Shinjuku Gyoen", item_kind: "knowledge", item_type: "activity", stage: "todo", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Day 1: 抵達東京，前往新宿御苑\nDay 2: 淺草寺");

    const plan = await generateTripPlan(TRIP_ID);

    expect(generateText).toHaveBeenCalledOnce();
    expect(plan).toContain("Day 1");
  });

  it("includes knowledge items in the prompt", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi Shinjuku", item_kind: "knowledge", item_type: "restaurant", stage: "todo", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Some plan");

    await generateTripPlan(TRIP_ID);

    const [, userMessage] = vi.mocked(generateText).mock.calls[0];
    expect(userMessage).toContain("Ramen Nagi Shinjuku");
  });

  it("includes confirmed decision items in the prompt context", async () => {
    const db = makeDb({
      trip_items: [
        { id: "d1", trip_id: TRIP_ID, title: "Choose hotel", item_kind: "decision", item_type: "hotel", stage: "confirmed", description: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Some plan");

    await generateTripPlan(TRIP_ID);

    const [, userMessage] = vi.mocked(generateText).mock.calls[0];
    expect(userMessage).toContain("Choose hotel");
  });

  it("includes trip destination and dates in the system prompt", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Plan");

    await generateTripPlan(TRIP_ID);

    const [systemPrompt, userMessage] = vi.mocked(generateText).mock.calls[0];
    expect(userMessage).toContain("Tokyo");
    expect(userMessage).toContain("2026-12-20");
    // System prompt should instruct the AI to be brief and conversational
    expect(systemPrompt).toMatch(/itinerary|planner/i);
  });

  it("returns a fallback message when Gemini throws", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockRejectedValue(new Error("Gemini API quota exceeded"));

    const plan = await generateTripPlan(TRIP_ID);

    expect(plan).toMatch(/couldn't generate|try again/i);
    expect(plan).not.toHaveLength(0);
  });

  it("returns an error message when the trip is not found", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const plan = await generateTripPlan("nonexistent-trip");

    expect(plan).toMatch(/could not load trip/i);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("does not throw when the trip has no items", async () => {
    const db = makeDb(); // empty trip_items
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Generic plan");

    await expect(generateTripPlan(TRIP_ID)).resolves.toBe("Generic plan");
  });
});
