/**
 * End-to-end flow: Knowledge base → Group decision → Confirmed choice
 *
 * Simulates the full user journey:
 *   1. Users add/share interesting places → knowledge base
 *   2. AI parsing detects more places → knowledge base
 *   3. Organiser runs /decide restaurant → creates decision item with options
 *   4. Group votes → winner confirmed
 *   5. /plan generates an itinerary using the knowledge base
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/gemini");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  pushFlex: vi.fn().mockResolvedValue(undefined),
  replyText: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { generateText } from "@/lib/gemini";
import { createItem } from "@/services/trip-state";
import {
  getKnowledgeItems,
  buildDecisionFromKnowledge,
  generateTripPlan,
} from "@/services/knowledge";
import { confirmItem } from "@/services/trip-state";
import { applyParseResult } from "@/services/parsing/item-generator";
import type { SuggestedAction } from "@/services/parsing/extractor";

const TRIP_ID = "trip-flow-001";
const GROUP_ID = "group-flow-001";
const EVENT_ID = "event-flow-001";

function seedDb() {
  return createMockDb({
    trips: [
      {
        id: TRIP_ID,
        group_id: GROUP_ID,
        status: "active",
        destination_name: "Osaka",
        start_date: "2026-12-20",
        end_date: "2026-12-24",
        title: "Osaka Winter Trip",
      },
    ],
    trip_items: [],
    trip_item_options: [],
    group_members: [
      { id: "m1", group_id: GROUP_ID, line_user_id: "user-1", left_at: null, role: "organizer" },
      { id: "m2", group_id: GROUP_ID, line_user_id: "user-2", left_at: null, role: "member" },
      { id: "m3", group_id: GROUP_ID, line_user_id: "user-3", left_at: null, role: "member" },
    ],
    parsed_entities: [],
    votes: [],
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── Stage 1: building the knowledge base ──────────────────────────────────────

describe("Stage 1 — building the knowledge base", () => {
  it("createItem with 'knowledge' kind adds to the knowledge base", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await createItem({ tripId: TRIP_ID, title: "Ramen Nagi Shinjuku", itemType: "restaurant", itemKind: "knowledge", source: "command" });
    await createItem({ tripId: TRIP_ID, title: "Ichiran Dotonbori", itemType: "restaurant", itemKind: "knowledge", source: "command" });
    await createItem({ tripId: TRIP_ID, title: "Kuromon Market", itemType: "activity", itemKind: "knowledge", source: "command" });

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.item_kind === "knowledge")).toBe(true);
  });

  it("AI add_option actions go to knowledge base (not vote options)", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const actions: SuggestedAction[] = [
      { action: "add_option", optionName: "Wanaka Ramen", itemType: "restaurant" },
      { action: "add_option", optionName: "Osaka Ohsho", itemType: "restaurant" },
    ];

    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, [], actions);

    const items = db._tables.get("trip_items") ?? [];
    const options = db._tables.get("trip_item_options") ?? [];

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.item_kind === "knowledge")).toBe(true);
    expect(options).toHaveLength(0); // no vote options created directly
  });

  it("knowledge items from different sources coexist without conflict", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // User manually adds a place
    await createItem({ tripId: TRIP_ID, title: "Dotonbori", itemType: "activity", itemKind: "knowledge", source: "command" });

    // AI detects a venue mention
    await applyParseResult(TRIP_ID, GROUP_ID, EVENT_ID, [], [
      { action: "add_option", optionName: "Namba Grand Kagetsu", itemType: "activity" },
    ]);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.item_kind === "knowledge")).toBe(true);
  });
});

// ── Stage 2: promoting knowledge to a group decision ─────────────────────────

describe("Stage 2 — promoting knowledge to a group decision", () => {
  it("getKnowledgeItems returns all restaurant knowledge items", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString(), source: "command" },
      { id: "k2", trip_id: TRIP_ID, title: "Ichiran", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString(), source: "ai" },
      { id: "k3", trip_id: TRIP_ID, title: "Kuromon", item_kind: "knowledge", item_type: "activity", stage: "todo", created_at: new Date().toISOString(), source: "command" },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const restaurants = await getKnowledgeItems(TRIP_ID, "restaurant");

    expect(restaurants).toHaveLength(2);
    expect(restaurants.some((r) => r.title === "Ramen Nagi")).toBe(true);
    expect(restaurants.some((r) => r.title === "Ichiran")).toBe(true);
  });

  it("buildDecisionFromKnowledge creates a decision with all knowledge items as options", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString(), source: "command", description: null },
      { id: "k2", trip_id: TRIP_ID, title: "Ichiran", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString(), source: "ai", description: null },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "restaurant", "Choose restaurant");

    expect(decisionId).not.toBeNull();

    const items = db._tables.get("trip_items") ?? [];
    const decision = items.find((i) => i.id === decisionId);
    expect(decision?.item_kind).toBe("decision");
    expect(decision?.title).toBe("Choose restaurant");

    const options = db._tables.get("trip_item_options") ?? [];
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.name)).toContain("Ramen Nagi");
    expect(options.map((o) => o.name)).toContain("Ichiran");
  });

  it("knowledge and decision items coexist — knowledge items are unmodified", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString(), source: "command", description: null },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await buildDecisionFromKnowledge(TRIP_ID, "restaurant");

    const items = db._tables.get("trip_items") ?? [];
    const knowledgeItem = items.find((i) => i.id === "k1");
    expect(knowledgeItem).toBeDefined();
    expect(knowledgeItem?.item_kind).toBe("knowledge"); // unchanged
    expect(knowledgeItem?.stage).toBe("todo");         // unchanged
  });
});

// ── Stage 3: confirming a decision ───────────────────────────────────────────

describe("Stage 3 — confirming the winning option", () => {
  it("confirmItem sets stage to confirmed and records the winning option", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "dec-001", trip_id: TRIP_ID, title: "Choose restaurant", item_kind: "decision", item_type: "restaurant", stage: "pending", created_at: new Date().toISOString() },
    ]);
    db._tables.set("trip_item_options", [
      { id: "opt-ramen", trip_item_id: "dec-001", name: "Ramen Nagi", provider: "manual", metadata_json: { knowledge_item_id: "k1" } },
      { id: "opt-ichiran", trip_item_id: "dec-001", name: "Ichiran", provider: "manual", metadata_json: { knowledge_item_id: "k2" } },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await confirmItem("dec-001", "opt-ramen");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("confirmed");
    expect(result.item.confirmed_option_id).toBe("opt-ramen");
  });

  it("knowledge items are unaffected when a decision is confirmed", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", created_at: new Date().toISOString() },
      { id: "dec-001", trip_id: TRIP_ID, title: "Choose restaurant", item_kind: "decision", item_type: "restaurant", stage: "pending", created_at: new Date().toISOString() },
    ]);
    db._tables.set("trip_item_options", [
      { id: "opt-ramen", trip_item_id: "dec-001", name: "Ramen Nagi", provider: "manual", metadata_json: {} },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await confirmItem("dec-001", "opt-ramen");

    const items = db._tables.get("trip_items") ?? [];
    const knowledgeItem = items.find((i) => i.id === "k1");
    expect(knowledgeItem?.stage).toBe("todo"); // unchanged
    expect(knowledgeItem?.item_kind).toBe("knowledge"); // unchanged
  });
});

// ── Stage 4: AI trip planning ─────────────────────────────────────────────────

describe("Stage 4 — AI trip plan generation", () => {
  it("generateTripPlan uses knowledge items to build the itinerary prompt", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo", description: null },
      { id: "k2", trip_id: TRIP_ID, title: "Dotonbori", item_kind: "knowledge", item_type: "activity", stage: "todo", description: "Famous canal" },
      { id: "dec", trip_id: TRIP_ID, title: "Choose hotel", item_kind: "decision", item_type: "hotel", stage: "confirmed", description: null },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Day 1: Arrive, check in\nDay 2: Ramen Nagi for lunch\nDay 3: Dotonbori evening walk");

    const plan = await generateTripPlan(TRIP_ID);

    expect(plan).toContain("Day 1");

    const [, userMessage] = vi.mocked(generateText).mock.calls[0];
    expect(userMessage).toContain("Ramen Nagi");
    expect(userMessage).toContain("Dotonbori");
    // Confirmed decision also appears in context
    expect(userMessage).toContain("Choose hotel");
  });

  it("plan is still generated even with no knowledge items", async () => {
    const db = seedDb(); // empty trip_items
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateText).mockResolvedValue("Generic 4-day Osaka itinerary");

    const plan = await generateTripPlan(TRIP_ID);

    expect(generateText).toHaveBeenCalledOnce();
    expect(plan).toContain("Generic");
  });
});

// ── Full flow assertion ───────────────────────────────────────────────────────

describe("Full knowledge → decision → confirm flow", () => {
  it("the board ends up with: knowledge items + a confirmed decision, all separate", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // Step 1: Add knowledge items
    await createItem({ tripId: TRIP_ID, title: "Ramen Nagi", itemType: "restaurant", itemKind: "knowledge", source: "command" });
    await createItem({ tripId: TRIP_ID, title: "Ichiran", itemType: "restaurant", itemKind: "knowledge", source: "command" });

    // Snapshot after knowledge adds
    let items = db._tables.get("trip_items") ?? [];
    expect(items.filter((i) => i.item_kind === "knowledge")).toHaveLength(2);
    expect(items.filter((i) => i.item_kind === "decision")).toHaveLength(0);

    // Step 2: Create decision from knowledge
    const decisionId = await buildDecisionFromKnowledge(TRIP_ID, "restaurant", "Choose restaurant");
    expect(decisionId).not.toBeNull();

    items = db._tables.get("trip_items") ?? [];
    expect(items.filter((i) => i.item_kind === "knowledge")).toHaveLength(2); // still there
    expect(items.filter((i) => i.item_kind === "decision")).toHaveLength(1);

    const options = db._tables.get("trip_item_options") ?? [];
    expect(options.filter((o) => o.trip_item_id === decisionId)).toHaveLength(2);

    // Step 3: Confirm the winning option
    const winningOption = options.find((o) => o.name === "Ramen Nagi");
    expect(winningOption).toBeDefined();

    // First move to pending so confirmItem's stage guard passes
    const decisionItem = items.find((i) => i.id === decisionId)!;
    db._tables.set("trip_items", items.map((i) => i.id === decisionId ? { ...i, stage: "pending" } : i));

    const confirmed = await confirmItem(decisionId!, winningOption!.id as string);
    expect(confirmed.ok).toBe(true);

    // Final state: 2 knowledge items still todo, 1 decision item confirmed
    items = db._tables.get("trip_items") ?? [];
    const knowledge = items.filter((i) => i.item_kind === "knowledge");
    const decisions = items.filter((i) => i.item_kind === "decision");

    expect(knowledge).toHaveLength(2);
    expect(knowledge.every((i) => i.stage === "todo")).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].stage).toBe("confirmed");
    expect(decisions[0].confirmed_option_id).toBe(winningOption!.id);
  });
});
