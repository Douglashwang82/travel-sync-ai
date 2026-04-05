import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { recordExpense, getExpenseSummary } from "@/services/expenses";

const GROUP_ID = "group-exp-001";
const TRIP_ID = "trip-exp-001";

beforeEach(() => {
  resetIdCounter();
});

// ── recordExpense ─────────────────────────────────────────────────────────────

describe("recordExpense", () => {
  it("persists the expense and equal splits", async () => {
    const db = createMockDb({ expenses: [], expense_splits: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const result = await recordExpense({
      groupId: GROUP_ID,
      tripId: TRIP_ID,
      paidByUserId: "alice",
      paidByDisplayName: "Alice",
      amount: 300,
      description: "Dinner",
      beneficiaries: [
        { userId: "alice", displayName: "Alice" },
        { userId: "bob", displayName: "Bob" },
        { userId: "carol", displayName: "Carol" },
      ],
    });

    expect(result.id).toBeTruthy();

    const splits = db._tables.get("expense_splits") ?? [];
    expect(splits).toHaveLength(3);

    // Base share = floor(300*100/3)/100 = 100.00
    const shares = splits.map((s) => Number(s.share_amount));
    expect(shares[0]).toBe(100);
    expect(shares[1]).toBe(100);
    // Last person absorbs rounding (300 - 100 - 100 = 100, remainder 0)
    expect(shares[2]).toBe(100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(300);
  });

  it("correctly handles non-divisible amounts (rounding to last person)", async () => {
    const db = createMockDb({ expenses: [], expense_splits: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await recordExpense({
      groupId: GROUP_ID,
      tripId: TRIP_ID,
      paidByUserId: "alice",
      paidByDisplayName: "Alice",
      amount: 10,
      description: "Coffee",
      beneficiaries: [
        { userId: "alice", displayName: "Alice" },
        { userId: "bob", displayName: "Bob" },
        { userId: "carol", displayName: "Carol" },
      ],
    });

    const splits = db._tables.get("expense_splits") ?? [];
    const shares = splits.map((s) => Number(s.share_amount));
    // floor(10*100/3)/100 = 3.33
    expect(shares[0]).toBe(3.33);
    expect(shares[1]).toBe(3.33);
    // last absorbs: 10 - 3.33 - 3.33 = 3.34
    expect(Math.round(shares[2] * 100) / 100).toBe(3.34);
    const total = Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(total).toBe(10);
  });

  it("throws when DB insert fails", async () => {
    const db = createMockDb({}, { expenses: { message: "DB error" } });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await expect(
      recordExpense({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        paidByUserId: "alice",
        paidByDisplayName: "Alice",
        amount: 100,
        description: "Test",
        beneficiaries: [{ userId: "alice", displayName: "Alice" }],
      })
    ).rejects.toThrow("Failed to insert expense");
  });
});

// ── getExpenseSummary ────────────────────────────────────────────────────────

describe("getExpenseSummary", () => {
  it("returns empty summary when no expenses", async () => {
    const db = createMockDb({ expenses: [], expense_splits: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);
    expect(summary.totalAmount).toBe(0);
    expect(summary.balances).toEqual([]);
    expect(summary.settlements).toEqual([]);
  });

  it("calculates net balances correctly for a single expense", async () => {
    // Alice paid 300, split equally between Alice, Bob, Carol (100 each)
    // Alice net: +300 - 100 = +200
    // Bob net: 0 - 100 = -100
    // Carol net: 0 - 100 = -100
    const expId = "exp-001";
    const db = createMockDb({
      expenses: [
        {
          id: expId,
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: "alice",
          paid_by_display_name: "Alice",
          amount: 300,
          description: "Dinner",
        },
      ],
      expense_splits: [
        { expense_id: expId, user_id: "alice", display_name: "Alice", share_amount: 100 },
        { expense_id: expId, user_id: "bob", display_name: "Bob", share_amount: 100 },
        { expense_id: expId, user_id: "carol", display_name: "Carol", share_amount: 100 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);

    expect(summary.totalAmount).toBe(300);
    const alice = summary.balances.find((b) => b.displayName === "Alice");
    const bob = summary.balances.find((b) => b.displayName === "Bob");
    const carol = summary.balances.find((b) => b.displayName === "Carol");

    expect(alice?.net).toBe(200);
    expect(bob?.net).toBe(-100);
    expect(carol?.net).toBe(-100);
  });

  it("produces minimum settlements via greedy debt simplification", async () => {
    // Alice paid 600 (Alice + Bob + Carol each owe 200)
    // Alice net: +400, Bob net: -200, Carol net: -200
    // Settlements: Bob → Alice 200, Carol → Alice 200
    const expId = "exp-002";
    const db = createMockDb({
      expenses: [
        {
          id: expId,
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: "alice",
          paid_by_display_name: "Alice",
          amount: 600,
          description: "Hotel",
        },
      ],
      expense_splits: [
        { expense_id: expId, user_id: "alice", display_name: "Alice", share_amount: 200 },
        { expense_id: expId, user_id: "bob", display_name: "Bob", share_amount: 200 },
        { expense_id: expId, user_id: "carol", display_name: "Carol", share_amount: 200 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);

    expect(summary.settlements).toHaveLength(2);
    expect(summary.settlements.every((s) => s.to === "Alice")).toBe(true);
    expect(summary.settlements.every((s) => s.amount === 200)).toBe(true);
    const fromNames = summary.settlements.map((s) => s.from).sort();
    expect(fromNames).toEqual(["Bob", "Carol"]);
  });

  it("handles multiple creditors and debtors correctly", async () => {
    // Alice paid 400, Bob paid 200, split equally among 4 people (Dave is also a beneficiary)
    // Each person's share: (400+200)/4 = 150
    // Alice: +400 - 150 = +250
    // Bob:   +200 - 150 = +50
    // Carol: 0 - 150 = -150
    // Dave:  0 - 150 = -150
    const expId1 = "multi-exp-1";
    const expId2 = "multi-exp-2";
    const db = createMockDb({
      expenses: [
        {
          id: expId1,
          group_id: GROUP_ID,
          trip_id: null,
          paid_by_user_id: "alice",
          paid_by_display_name: "Alice",
          amount: 400,
          description: "Flight",
        },
        {
          id: expId2,
          group_id: GROUP_ID,
          trip_id: null,
          paid_by_user_id: "bob",
          paid_by_display_name: "Bob",
          amount: 200,
          description: "Bus",
        },
      ],
      expense_splits: [
        { expense_id: expId1, user_id: "alice", display_name: "Alice", share_amount: 100 },
        { expense_id: expId1, user_id: "bob", display_name: "Bob", share_amount: 100 },
        { expense_id: expId1, user_id: "carol", display_name: "Carol", share_amount: 100 },
        { expense_id: expId1, user_id: "dave", display_name: "Dave", share_amount: 100 },
        { expense_id: expId2, user_id: "alice", display_name: "Alice", share_amount: 50 },
        { expense_id: expId2, user_id: "bob", display_name: "Bob", share_amount: 50 },
        { expense_id: expId2, user_id: "carol", display_name: "Carol", share_amount: 50 },
        { expense_id: expId2, user_id: "dave", display_name: "Dave", share_amount: 50 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, null);

    expect(summary.totalAmount).toBe(600);
    // Net balances: Alice +250, Bob +50, Carol -150, Dave -150
    const alice = summary.balances.find((b) => b.displayName === "Alice");
    const bob = summary.balances.find((b) => b.displayName === "Bob");
    expect(alice?.net).toBe(250);
    expect(bob?.net).toBe(50);

    // All settlement amounts should sum to zero net
    const totalOut = summary.settlements.reduce((sum, s) => sum + s.amount, 0);
    const totalOwed = summary.balances.filter((b) => b.net < 0).reduce((sum, b) => sum + Math.abs(b.net), 0);
    expect(Math.round(totalOut * 100) / 100).toBe(Math.round(totalOwed * 100) / 100);
  });

  it("excludes users with near-zero balance", async () => {
    // Single person pays and is the only beneficiary → net = 0, excluded
    const expId = "self-exp";
    const db = createMockDb({
      expenses: [
        {
          id: expId,
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: "alice",
          paid_by_display_name: "Alice",
          amount: 100,
          description: "Solo",
        },
      ],
      expense_splits: [{ expense_id: expId, user_id: "alice", display_name: "Alice", share_amount: 100 }],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);
    expect(summary.balances).toEqual([]); // net=0 filtered out
    expect(summary.settlements).toEqual([]);
  });

  it("scopes to tripId when provided", async () => {
    const expInTrip = "exp-in-trip";
    const expOutTrip = "exp-out-trip";
    const db = createMockDb({
      expenses: [
        {
          id: expInTrip,
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: "alice",
          paid_by_display_name: "Alice",
          amount: 100,
          description: "In trip",
        },
        {
          id: expOutTrip,
          group_id: GROUP_ID,
          trip_id: "other-trip",
          paid_by_user_id: "bob",
          paid_by_display_name: "Bob",
          amount: 500,
          description: "Other trip",
        },
      ],
      expense_splits: [
        { expense_id: expInTrip, user_id: "alice", display_name: "Alice", share_amount: 50 },
        { expense_id: expInTrip, user_id: "bob", display_name: "Bob", share_amount: 50 },
        { expense_id: expOutTrip, user_id: "bob", display_name: "Bob", share_amount: 500 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);
    expect(summary.totalAmount).toBe(100);
  });
});
