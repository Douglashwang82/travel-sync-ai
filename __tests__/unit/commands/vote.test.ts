import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  replyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/decisions", () => ({
  startDecision: vi.fn().mockResolvedValue(undefined),
  refreshVoteCarousel: vi.fn().mockResolvedValue(undefined),
  announceWinner: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { startDecision } from "@/services/decisions";
import { handleVote } from "@/bot/commands/vote";
import type { CommandContext } from "@/bot/router";

const GROUP_DB_ID = "group-vote-001";
const TRIP_ID = "trip-vote-001";
const LINE_GROUP_ID = "C-line-vote";

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
    replyToken: "reply-token-vote",
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── only matches decision items ───────────────────────────────────────────────

describe("handleVote — only matches decision items", () => {
  it("starts a vote when a matching decision item is found", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-001",
          trip_id: TRIP_ID,
          title: "Choose hotel",
          item_kind: "decision",
          item_type: "hotel",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(startDecision).toHaveBeenCalledOnce();
    const call = vi.mocked(startDecision).mock.calls[0][0];
    expect(call.itemId).toBe("dec-001");
    expect(call.tripId).toBe(TRIP_ID);
  });

  it("does NOT match knowledge items — redirects to /decide", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "know-001",
          trip_id: TRIP_ID,
          title: "Park Hyatt Tokyo",
          item_kind: "knowledge",
          item_type: "hotel",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(startDecision).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/\/decide/i);
  });

  it("reply mentions /decide when only knowledge items exist for that type", async () => {
    const db = makeDb({
      trip_items: [
        { id: "k1", trip_id: TRIP_ID, title: "Ramen Nagi", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
        { id: "k2", trip_id: TRIP_ID, title: "Ichiran", item_kind: "knowledge", item_type: "restaurant", stage: "todo" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["restaurant"], makeCtx(), reply);

    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/\/decide/i);
  });

  it("matches decision item by item_type keyword", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-rest",
          trip_id: TRIP_ID,
          title: "Choose restaurant",
          item_kind: "decision",
          item_type: "restaurant",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["restaurant"], makeCtx(), reply);

    expect(startDecision).toHaveBeenCalledOnce();
  });

  it("matches decision item by title substring", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-hotel",
          trip_id: TRIP_ID,
          title: "Choose hotel for night 1",
          item_kind: "decision",
          item_type: "other",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(startDecision).toHaveBeenCalledOnce();
  });
});

// ── already-pending decision ──────────────────────────────────────────────────

describe("handleVote — already-pending item", () => {
  it("replies that voting is already open when item is pending", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-pending",
          trip_id: TRIP_ID,
          title: "Choose hotel",
          item_kind: "decision",
          item_type: "hotel",
          stage: "pending",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(startDecision).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/already open|voting.*open/i);
  });
});

// ── no items ──────────────────────────────────────────────────────────────────

describe("handleVote — no matching items", () => {
  it("replies with 'not found' when no items exist", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(startDecision).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("replies with usage hint when args are empty", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote([], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/usage/i);
  });

  it("replies with 'no active trip' when trip is missing", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/no active trip/i);
  });
});

// ── startDecision failure handling ────────────────────────────────────────────

describe("handleVote — startDecision failure", () => {
  it("pushes an error message if startDecision rejects", async () => {
    const db = makeDb({
      trip_items: [
        {
          id: "dec-fail",
          trip_id: TRIP_ID,
          title: "Choose hotel",
          item_kind: "decision",
          item_type: "hotel",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(startDecision).mockRejectedValue(new Error("Places API down"));

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVote(["hotel"], makeCtx(), reply);

    // Should not throw — error is caught and a push message is sent
    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toMatch(/sorry|wrong|try/i);
  });
});
