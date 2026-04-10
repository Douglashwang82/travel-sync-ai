import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  replyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/knowledge", () => ({
  getKnowledgeItems: vi.fn(),
  buildDecisionFromKnowledge: vi.fn(),
  generateTripPlan: vi.fn(),
}));
vi.mock("@/services/decisions", () => ({
  startDecision: vi.fn().mockResolvedValue(undefined),
  refreshVoteCarousel: vi.fn().mockResolvedValue(undefined),
  announceWinner: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { getKnowledgeItems, buildDecisionFromKnowledge } from "@/services/knowledge";
import { startDecision } from "@/services/decisions";
import { handleDecide } from "@/bot/commands/decide";
import type { CommandContext } from "@/bot/router";

const GROUP_DB_ID = "group-decide-001";
const TRIP_ID = "trip-decide-001";
const LINE_GROUP_ID = "C-line-decide";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trips: [{ id: TRIP_ID, group_id: GROUP_DB_ID, status: "active", destination_name: "Kyoto" }],
    trip_items: [],
    ...extra,
  });
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    lineGroupId: LINE_GROUP_ID,
    dbGroupId: GROUP_DB_ID,
    userId: "user-001",
    replyToken: "reply-token-decide",
    ...overrides,
  };
}

// Fake knowledge items representing saved restaurants
const MOCK_RESTAURANTS = [
  { id: "k1", title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant" },
  { id: "k2", title: "Sushi Saito", item_kind: "knowledge", item_type: "restaurant" },
];

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("handleDecide — happy path", () => {
  it("calls buildDecisionFromKnowledge with the trip ID and inferred type", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue("new-decision-id");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(buildDecisionFromKnowledge).toHaveBeenCalledOnce();
    const [passedTripId, passedType] = vi.mocked(buildDecisionFromKnowledge).mock.calls[0];
    expect(passedTripId).toBe(TRIP_ID);
    expect(passedType).toBe("restaurant");
  });

  it("calls startDecision after creating the decision item", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue("new-decision-id");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(startDecision).toHaveBeenCalledOnce();
    const call = vi.mocked(startDecision).mock.calls[0][0];
    expect(call.itemId).toBe("new-decision-id");
    expect(call.tripId).toBe(TRIP_ID);
    expect(call.lineGroupId).toBe(LINE_GROUP_ID);
  });

  it("replies with a count of found knowledge items before starting the vote", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue("decision-id");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toContain("2");
    expect(message).toMatch(/restaurant/i);
    expect(message).toMatch(/starting vote/i);
  });

  it("passes a custom 'Choose [query]' title to buildDecisionFromKnowledge", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue("decision-id");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    const [, , title] = vi.mocked(buildDecisionFromKnowledge).mock.calls[0];
    expect(title).toMatch(/Choose restaurant/i);
  });
});

// ── no knowledge items ────────────────────────────────────────────────────────

describe("handleDecide — no knowledge items", () => {
  it("replies with 'no saved places' message when knowledge base is empty", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue([]);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(buildDecisionFromKnowledge).not.toHaveBeenCalled();
    expect(startDecision).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/no saved/i);
  });

  it("reply hints to use /add or /share to add places first", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue([]);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["hotel"], makeCtx(), reply);

    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/\/add|\/share/i);
  });
});

// ── buildDecisionFromKnowledge failure ────────────────────────────────────────

describe("handleDecide — decision creation failure", () => {
  it("pushes an error message when buildDecisionFromKnowledge returns null", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue(null);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(startDecision).not.toHaveBeenCalled();
    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toMatch(/went wrong/i);
  });
});

// ── startDecision failure ────────────────────────────────────────────────────

describe("handleDecide — startDecision failure", () => {
  it("pushes an error message if startDecision rejects", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(getKnowledgeItems).mockResolvedValue(MOCK_RESTAURANTS as ReturnType<typeof getKnowledgeItems> extends Promise<infer T> ? T : never);
    vi.mocked(buildDecisionFromKnowledge).mockResolvedValue("decision-id");
    vi.mocked(startDecision).mockRejectedValue(new Error("DB error"));

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    // Error caught — should not throw
    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toMatch(/sorry|wrong|\/decide/i);
  });
});

// ── validation ────────────────────────────────────────────────────────────────

describe("handleDecide — validation", () => {
  it("replies with usage hint when no args are provided", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide([], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/usage/i);
    expect(getKnowledgeItems).not.toHaveBeenCalled();
  });

  it("replies with 'no active trip' when trip is missing", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/no active trip/i);
    expect(getKnowledgeItems).not.toHaveBeenCalled();
  });

  it("replies with usage hint when dbGroupId is missing", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleDecide(["restaurant"], makeCtx({ dbGroupId: null }), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/usage/i);
  });
});
