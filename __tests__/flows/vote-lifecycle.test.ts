/**
 * Vote lifecycle flow test.
 *
 * Simulates the full journey from /vote command through voting to auto-confirmation:
 *
 *   1. Organizer sends /vote hotel → item moves to pending
 *   2. Group members vote
 *   3. Majority is reached → item auto-confirmed
 *   4. LIFF board reflects the confirmed item
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/liff-server", () => ({
  requireTripMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "user-0",
    membership: { groupId: "group-flow-001", role: "organizer" },
  }),
}));

import { createAdminClient } from "@/lib/db";
import { startVote, reopenItem } from "@/services/trip-state";
import { castVote, closeVote } from "@/services/vote";
import { GET as getBoardGET } from "@/app/api/liff/board/route";

const GROUP_ID = "group-flow-001";
const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPTION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPTION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function seedDb() {
  return createMockDb({
    trips: [
      {
        id: TRIP_ID,
        group_id: GROUP_ID,
        destination_name: "Tokyo",
        start_date: "2026-05-01",
        end_date: "2026-05-10",
        status: "active",
      },
    ],
    trip_items: [
      {
        id: ITEM_ID,
        trip_id: TRIP_ID,
        title: "Choose hotel",
        stage: "todo",
        item_type: "hotel",
        source: "command",
        deadline_at: null,
        confirmed_option_id: null,
        tie_extension_count: 0,
      },
    ],
    trip_item_options: [
      { id: OPTION_A, trip_item_id: ITEM_ID, name: "Park Hyatt Tokyo" },
      { id: OPTION_B, trip_item_id: ITEM_ID, name: "Shinjuku Granbell Hotel" },
    ],
    votes: [],
    group_members: [
      { id: "m0", group_id: GROUP_ID, line_user_id: "user-0", left_at: null, role: "organizer" },
      { id: "m1", group_id: GROUP_ID, line_user_id: "user-1", left_at: null, role: "member" },
      { id: "m2", group_id: GROUP_ID, line_user_id: "user-2", left_at: null, role: "member" },
      { id: "m3", group_id: GROUP_ID, line_user_id: "user-3", left_at: null, role: "member" },
    ],
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

describe("Vote lifecycle flow", () => {
  it("complete flow: todo → pending → votes cast → majority → confirmed", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // ── Step 1: Start vote (todo → pending) ──────────────────────────────────
    const deadline = new Date(Date.now() + 24 * 3600_000).toISOString();
    const startResult = await startVote(ITEM_ID, deadline);

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;
    expect(startResult.item.stage).toBe("pending");
    expect(startResult.item.deadline_at).toBe(deadline);

    // ── Step 2: Members vote (group of 4, need >2 = 3 votes for majority) ───
    // user-1 votes for option-a
    const vote1 = await castVote({ tripItemId: ITEM_ID, optionId: OPTION_A, groupId: GROUP_ID, lineUserId: "user-1" });
    expect(vote1.accepted).toBe(true);
    expect(vote1.majority.reached).toBe(false);

    // user-2 votes for option-a
    const vote2 = await castVote({ tripItemId: ITEM_ID, optionId: OPTION_A, groupId: GROUP_ID, lineUserId: "user-2" });
    expect(vote2.accepted).toBe(true);
    expect(vote2.majority.reached).toBe(false); // 2/4 → not > 2

    // user-3 votes for option-a — this is the 3rd vote, 3 > 2 → majority!
    const vote3 = await castVote({ tripItemId: ITEM_ID, optionId: OPTION_A, groupId: GROUP_ID, lineUserId: "user-3" });
    expect(vote3.accepted).toBe(true);
    expect(vote3.majority.reached).toBe(true);
    expect(vote3.majority.winningOptionId).toBe(OPTION_A);

    // ── Step 3: Close vote (pending → confirmed) ────────────────────────────
    const closeResult = await closeVote(ITEM_ID, OPTION_A, GROUP_ID, vote3.totalVotes);
    expect(closeResult.closed).toBe(true);

    // ── Step 4: Verify LIFF board shows confirmed item ──────────────────────
    const req = new NextRequest(`http://localhost/api/liff/board?tripId=${TRIP_ID}`);
    const res = await getBoardGET(req);
    const board = await res.json();

    expect(board.confirmed).toHaveLength(1);
    expect(board.confirmed[0].title).toBe("Choose hotel");
    expect(board.confirmed[0].stage).toBe("confirmed");
    expect(board.confirmed[0].confirmed_option_id).toBe(OPTION_A);

    expect(board.pending).toHaveLength(0);
    expect(board.todo).toHaveLength(0);
  });

  it("concurrent close: second closeVote returns closed:false and does not re-confirm", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const deadline = new Date(Date.now() + 86400_000).toISOString();
    await startVote(ITEM_ID, deadline);

    // First close — should succeed
    const first = await closeVote(ITEM_ID, OPTION_A, GROUP_ID, 3);
    expect(first.closed).toBe(true);

    // Second close — simulates concurrent request arriving after first already committed
    const second = await closeVote(ITEM_ID, OPTION_A, GROUP_ID, 3);
    expect(second.closed).toBe(false);

    // Item still confirmed with the correct option (not double-written)
    const items = db._tables.get("trip_items") ?? [];
    const item = items.find((r) => r.id === ITEM_ID);
    expect(item?.stage).toBe("confirmed");
    expect(item?.confirmed_option_id).toBe(OPTION_A);
  });

  it("user can change their vote before majority", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const deadline = new Date(Date.now() + 86400_000).toISOString();
    await startVote(ITEM_ID, deadline);

    // user-1 initially votes option-a
    const initial = await castVote({ tripItemId: ITEM_ID, optionId: OPTION_A, groupId: GROUP_ID, lineUserId: "user-1" });
    expect(initial.tally.get(OPTION_A)).toBe(1);

    // user-1 changes to option-b
    const changed = await castVote({ tripItemId: ITEM_ID, optionId: OPTION_B, groupId: GROUP_ID, lineUserId: "user-1" });
    expect(changed.tally.get(OPTION_B)).toBe(1);
    expect(changed.tally.get(OPTION_A)).toBeUndefined(); // vote replaced

    // Total votes still 1
    expect(changed.totalVotes).toBe(1);
  });

  it("organizer can reopen a confirmed item", async () => {
    const db = seedDb();
    // Put item in confirmed state
    db._tables.set("trip_items", [
      {
        id: ITEM_ID,
        trip_id: TRIP_ID,
        title: "Choose hotel",
        stage: "confirmed",
        item_type: "hotel",
        confirmed_option_id: OPTION_A,
        deadline_at: null,
        tie_extension_count: 0,
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await reopenItem(ITEM_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.stage).toBe("todo");
    expect(result.item.confirmed_option_id).toBeNull();

    // LIFF board should now show item in todo
    const req = new NextRequest(`http://localhost/api/liff/board?tripId=${TRIP_ID}`);
    const res = await getBoardGET(req);
    const board = await res.json();
    expect(board.todo).toHaveLength(1);
    expect(board.confirmed).toHaveLength(0);
  });

  it("reopen after tied vote resets tie_extension_count so next vote starts fresh", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      {
        id: ITEM_ID,
        trip_id: TRIP_ID,
        title: "Choose hotel",
        stage: "pending",
        item_type: "hotel",
        confirmed_option_id: null,
        deadline_at: "2026-04-06T00:00:00Z",
        tie_extension_count: 2, // was extended twice
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await reopenItem(ITEM_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.tie_extension_count).toBe(0);
    expect(result.item.deadline_at).toBeNull();
  });
});
