import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  replyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/knowledge", () => ({
  getKnowledgeItems: vi.fn(),
  buildDecisionFromKnowledge: vi.fn(),
  generateTripPlan: vi.fn(),
}));

import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { generateTripPlan } from "@/services/knowledge";
import { handlePlan } from "@/bot/commands/plan";
import type { CommandContext } from "@/bot/router";

const GROUP_DB_ID = "group-plan-001";
const TRIP_ID = "trip-plan-001";
const LINE_GROUP_ID = "C-line-plan";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trips: [{ id: TRIP_ID, group_id: GROUP_DB_ID, status: "active", destination_name: "Osaka" }],
    trip_items: [],
    ...extra,
  });
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    lineGroupId: LINE_GROUP_ID,
    dbGroupId: GROUP_DB_ID,
    userId: "user-001",
    replyToken: "reply-token-plan",
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("handlePlan — happy path", () => {
  it("calls generateTripPlan with the active trip ID", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateTripPlan).mockResolvedValue("Day 1: Arrive Osaka\nDay 2: Dotonbori");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx(), reply);

    expect(generateTripPlan).toHaveBeenCalledOnce();
    const [tripId] = vi.mocked(generateTripPlan).mock.calls[0];
    expect(tripId).toBe(TRIP_ID);
  });

  it("sends the AI-generated plan via pushText", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const plan = "Day 1: 抵達大阪，前往道頓堀\nDay 2: 黑門市場";
    vi.mocked(generateTripPlan).mockResolvedValue(plan);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx(), reply);

    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toBe(plan);
  });

  it("first replies to acknowledge (loading message) then posts the plan", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateTripPlan).mockResolvedValue("Plan content");

    const callOrder: string[] = [];
    const reply = vi.fn().mockImplementation(async () => {
      callOrder.push("reply");
    });
    vi.mocked(pushText).mockImplementation(async () => {
      callOrder.push("pushText");
    });

    await handlePlan(makeCtx(), reply);

    // reply (acknowledgement) must come before pushText (the plan)
    expect(callOrder[0]).toBe("reply");
    expect(callOrder[1]).toBe("pushText");
  });

  it("acknowledgement message mentions the knowledge base", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(generateTripPlan).mockResolvedValue("Some plan");

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx(), reply);

    const [ackMessage] = reply.mock.calls[0];
    expect(ackMessage).toMatch(/knowledge base|plan|moment/i);
  });
});

// ── no active trip ────────────────────────────────────────────────────────────

describe("handlePlan — no active trip", () => {
  it("replies with 'no active trip' and does not call generateTripPlan", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx(), reply);

    expect(generateTripPlan).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/no active trip/i);
  });
});

// ── missing context ───────────────────────────────────────────────────────────

describe("handlePlan — missing context", () => {
  it("replies with an error when dbGroupId is missing", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx({ dbGroupId: null }), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/could not identify|group/i);
    expect(generateTripPlan).not.toHaveBeenCalled();
  });

  it("replies with an error when lineGroupId is missing", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handlePlan(makeCtx({ lineGroupId: "" }), reply);

    expect(reply).toHaveBeenCalledOnce();
    expect(generateTripPlan).not.toHaveBeenCalled();
  });
});
