/**
 * Expense tracking flow test.
 *
 * Simulates the full journey:
 *   1. Trip has several members
 *   2. Multiple expenses are logged (different payers)
 *   3. /exp-summary shows correct balances and minimum settlement plan
 *   4. Verify settlements eliminate all debt with minimum transactions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { recordExpense, getExpenseSummary } from "@/services/expenses";

const GROUP_ID = "group-expense-flow";
const TRIP_ID = "trip-expense-flow";

function seedDb() {
  return createMockDb({
    group_members: [
      { id: "m1", group_id: GROUP_ID, line_user_id: "alice", display_name: "Alice", left_at: null },
      { id: "m2", group_id: GROUP_ID, line_user_id: "bob", display_name: "Bob", left_at: null },
      { id: "m3", group_id: GROUP_ID, line_user_id: "carol", display_name: "Carol", left_at: null },
      { id: "m4", group_id: GROUP_ID, line_user_id: "dave", display_name: "Dave", left_at: null },
    ],
    expenses: [],
    expense_splits: [],
  });
}

const ALL_4 = [
  { userId: "alice", displayName: "Alice" },
  { userId: "bob", displayName: "Bob" },
  { userId: "carol", displayName: "Carol" },
  { userId: "dave", displayName: "Dave" },
];

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

describe("Expense tracking flow", () => {
  it("single expense — correct balances and settlement", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // Alice pays 400 for the group dinner
    await recordExpense({
      groupId: GROUP_ID,
      tripId: TRIP_ID,
      paidByUserId: "alice",
      paidByDisplayName: "Alice",
      amount: 400,
      description: "Group dinner",
      beneficiaries: ALL_4,
    });

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);

    // Each person's share = 100
    // Alice: +400 - 100 = +300
    // Bob: -100, Carol: -100, Dave: -100
    expect(summary.totalAmount).toBe(400);

    const alice = summary.balances.find((b) => b.displayName === "Alice");
    expect(alice?.net).toBe(300);

    // 3 settlements: Bob → Alice 100, Carol → Alice 100, Dave → Alice 100
    expect(summary.settlements).toHaveLength(3);
    expect(summary.settlements.every((s) => s.to === "Alice")).toBe(true);
    expect(summary.settlements.every((s) => s.amount === 100)).toBe(true);
  });

  it("multiple expenses from different payers — minimised settlement plan", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // Day 1: Alice pays 400 for all 4 (100 each)
    await recordExpense({
      groupId: GROUP_ID,
      tripId: TRIP_ID,
      paidByUserId: "alice",
      paidByDisplayName: "Alice",
      amount: 400,
      description: "Hotel",
      beneficiaries: ALL_4,
    });

    // Day 2: Bob pays 200 for Alice and Bob only (100 each)
    await recordExpense({
      groupId: GROUP_ID,
      tripId: TRIP_ID,
      paidByUserId: "bob",
      paidByDisplayName: "Bob",
      amount: 200,
      description: "Lunch",
      beneficiaries: [
        { userId: "alice", displayName: "Alice" },
        { userId: "bob", displayName: "Bob" },
      ],
    });

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);

    // Net balances:
    // Alice: +400 (paid) - 100 (hotel share) - 100 (lunch share) = +200
    // Bob: +200 (paid) - 100 (hotel share) - 100 (lunch share) = 0 → filtered out
    // Carol: 0 - 100 (hotel share) = -100
    // Dave: 0 - 100 (hotel share) = -100

    expect(summary.totalAmount).toBe(600);

    const alice = summary.balances.find((b) => b.displayName === "Alice");
    expect(alice?.net).toBe(200);

    const bob = summary.balances.find((b) => b.displayName === "Bob");
    expect(bob).toBeUndefined(); // net = 0 → filtered out

    // 2 settlements: Carol → Alice 100, Dave → Alice 100
    expect(summary.settlements).toHaveLength(2);
    expect(summary.settlements.every((s) => s.to === "Alice")).toBe(true);
    const fromNames = summary.settlements.map((s) => s.from).sort();
    expect(fromNames).toEqual(["Carol", "Dave"]);
  });

  it("all settlements sum to zero net debt", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // Complex scenario: 5 expenses from different payers
    const expenses = [
      { payer: "alice", amount: 1200, desc: "Flight" },
      { payer: "bob", amount: 800, desc: "Hotel" },
      { payer: "carol", amount: 300, desc: "Activities" },
      { payer: "dave", amount: 150, desc: "Taxi" },
    ];

    for (const exp of expenses) {
      await recordExpense({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        paidByUserId: exp.payer,
        paidByDisplayName: exp.payer.charAt(0).toUpperCase() + exp.payer.slice(1),
        amount: exp.amount,
        description: exp.desc,
        beneficiaries: ALL_4,
      });
    }

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);

    // All creditor amounts should equal all debtor amounts
    const totalCredit = summary.balances.filter((b) => b.net > 0).reduce((s, b) => s + b.net, 0);
    const totalDebt = summary.balances.filter((b) => b.net < 0).reduce((s, b) => s + Math.abs(b.net), 0);
    expect(Math.round(totalCredit * 100)).toBe(Math.round(totalDebt * 100));

    // All settlement amounts should total to the total debt
    const settlementTotal = summary.settlements.reduce((s, t) => s + t.amount, 0);
    expect(Math.round(settlementTotal * 100)).toBe(Math.round(totalDebt * 100));
  });

  it("no expenses — returns empty summary", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const summary = await getExpenseSummary(GROUP_ID, TRIP_ID);
    expect(summary.totalAmount).toBe(0);
    expect(summary.balances).toHaveLength(0);
    expect(summary.settlements).toHaveLength(0);
  });

  it("expense scoped to null tripId (pre-trip expense) appears in non-trip summary", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // No tripId (pre-trip logistics)
    await recordExpense({
      groupId: GROUP_ID,
      tripId: null,
      paidByUserId: "alice",
      paidByDisplayName: "Alice",
      amount: 100,
      description: "Visa application",
      beneficiaries: ALL_4,
    });

    // Summary without tripId filter
    const summary = await getExpenseSummary(GROUP_ID, null);
    expect(summary.totalAmount).toBe(100);
  });
});
