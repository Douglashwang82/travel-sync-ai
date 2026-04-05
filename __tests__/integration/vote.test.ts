import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/trip-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/trip-state")>();
  return { ...actual };
});

import { createAdminClient } from "@/lib/db";
import { castVote, getVoteTally } from "@/services/vote";

const TRIP_ITEM_ID = "item-vote-001";
const GROUP_ID = "group-vote-001";
const OPTION_A = "option-a";
const OPTION_B = "option-b";

function makeDb(stage = "pending", memberCount = 4) {
  return createMockDb({
    trip_items: [{ id: TRIP_ITEM_ID, stage, trip_id: "trip-001", title: "Hotel vote" }],
    votes: [],
    group_members: Array.from({ length: memberCount }, (_, i) => ({
      id: `member-${i}`,
      group_id: GROUP_ID,
      line_user_id: `user-${i}`,
      left_at: null,
    })),
  });
}

beforeEach(() => {
  resetIdCounter();
});

// ── castVote ──────────────────────────────────────────────────────────────────

describe("castVote", () => {
  it("accepts a valid vote and records it", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_A,
      groupId: GROUP_ID,
      lineUserId: "user-0",
    });

    expect(result.accepted).toBe(true);
    expect(result.totalVotes).toBe(1);
    expect(result.tally.get(OPTION_A)).toBe(1);

    const votes = db._tables.get("votes") ?? [];
    expect(votes).toHaveLength(1);
    expect(votes[0].option_id).toBe(OPTION_A);
    expect(votes[0].line_user_id).toBe("user-0");
  });

  it("rejects vote when item stage is not pending", async () => {
    const db = makeDb("todo");
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_A,
      groupId: GROUP_ID,
      lineUserId: "user-0",
    });

    expect(result.accepted).toBe(false);
    expect(result.error).toMatch(/no longer open/i);
  });

  it("rejects vote when item is already confirmed", async () => {
    const db = makeDb("confirmed");
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_A,
      groupId: GROUP_ID,
      lineUserId: "user-0",
    });

    expect(result.accepted).toBe(false);
  });

  it("allows user to change their vote (upsert)", async () => {
    const db = makeDb();
    // Pre-populate an existing vote from user-0 for option-a
    db._tables.set("votes", [
      {
        id: "vote-existing",
        trip_item_id: TRIP_ITEM_ID,
        option_id: OPTION_A,
        group_id: GROUP_ID,
        line_user_id: "user-0",
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // User changes vote to option-b
    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_B,
      groupId: GROUP_ID,
      lineUserId: "user-0",
    });

    expect(result.accepted).toBe(true);
    // Tally should now only show option-b with count 1
    expect(result.tally.get(OPTION_B)).toBe(1);
    expect(result.tally.get(OPTION_A)).toBeUndefined();
  });

  it("detects majority when > half the group votes for the same option", async () => {
    // Group of 4: majority threshold = 4/2 = 2 → need > 2 votes = 3
    const db = makeDb("pending", 4);
    // Pre-populate 2 votes for option-a
    db._tables.set("votes", [
      { id: "v1", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_A, group_id: GROUP_ID, line_user_id: "user-1" },
      { id: "v2", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_A, group_id: GROUP_ID, line_user_id: "user-2" },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // Cast the 3rd vote for option-a → majority reached
    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_A,
      groupId: GROUP_ID,
      lineUserId: "user-3",
    });

    expect(result.accepted).toBe(true);
    expect(result.majority.reached).toBe(true);
    expect(result.majority.winningOptionId).toBe(OPTION_A);
    expect(result.majority.winningCount).toBe(3);
  });

  it("does not declare majority when votes are split", async () => {
    // Group of 4, 2 votes split between options → no majority
    const db = makeDb("pending", 4);
    db._tables.set("votes", [
      { id: "v1", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_A, group_id: GROUP_ID, line_user_id: "user-1" },
      { id: "v2", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_B, group_id: GROUP_ID, line_user_id: "user-2" },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await castVote({
      tripItemId: TRIP_ITEM_ID,
      optionId: OPTION_A,
      groupId: GROUP_ID,
      lineUserId: "user-3",
    });

    // 2 votes for A out of 4 members = 2 > 4/2 = 2 → false (must be STRICTLY greater)
    expect(result.majority.reached).toBe(false);
  });
});

// ── getVoteTally ──────────────────────────────────────────────────────────────

describe("getVoteTally", () => {
  it("returns empty map when no votes", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const tally = await getVoteTally(TRIP_ITEM_ID);
    expect(tally.size).toBe(0);
  });

  it("counts votes correctly per option", async () => {
    const db = makeDb();
    db._tables.set("votes", [
      { id: "v1", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_A, group_id: GROUP_ID, line_user_id: "u1" },
      { id: "v2", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_A, group_id: GROUP_ID, line_user_id: "u2" },
      { id: "v3", trip_item_id: TRIP_ITEM_ID, option_id: OPTION_B, group_id: GROUP_ID, line_user_id: "u3" },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const tally = await getVoteTally(TRIP_ITEM_ID);
    expect(tally.get(OPTION_A)).toBe(2);
    expect(tally.get(OPTION_B)).toBe(1);
  });
});
