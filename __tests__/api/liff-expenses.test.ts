import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/liff-server", () => ({
  authenticateLiffRequest: vi.fn().mockResolvedValue({ ok: true, lineUserId: "Uabcdef1234567890" }),
  requireGroupMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Uabcdef1234567890",
    membership: { groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "member" },
  }),
  requireTripMembership: vi.fn().mockResolvedValue({
    ok: true,
    lineUserId: "Uabcdef1234567890",
    membership: { groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "member" },
  }),
}));
vi.mock("@/services/expenses", async (importOriginal) => {
  // Re-export real implementation but allow db mock to intercept
  const real = await importOriginal<typeof import("@/services/expenses")>();
  return real;
});

import { createAdminClient } from "@/lib/db";
import { GET, POST } from "@/app/api/liff/expenses/route";

const GROUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "Uabcdef1234567890";

function makeGetRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/liff/expenses?${qs}`);
}

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/liff/expenses", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/liff/expenses — validation", () => {
  it("returns 400 when groupId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when groupId is not a UUID", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({ groupId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tripId is present but not a UUID", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({ groupId: GROUP_ID, tripId: "bad" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/liff/expenses — empty state", () => {
  it("returns empty summary when no expenses exist", async () => {
    const db = createMockDb({ expenses: [], expense_splits: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({ groupId: GROUP_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalAmount).toBe(0);
    expect(body.expenses).toHaveLength(0);
    expect(body.balances).toHaveLength(0);
    expect(body.settlements).toHaveLength(0);
  });
});

describe("GET /api/liff/expenses — with data", () => {
  it("returns expense list and totals", async () => {
    const db = createMockDb({
      expenses: [
        {
          id: "exp1",
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: USER_ID,
          paid_by_display_name: "Alice",
          amount: 3000,
          description: "Dinner",
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          id: "exp2",
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: "U999",
          paid_by_display_name: "Bob",
          amount: 1500,
          description: "Taxi",
          created_at: "2026-05-02T00:00:00Z",
        },
      ],
      expense_splits: [
        { expense_id: "exp1", user_id: USER_ID, display_name: "Alice", share_amount: 1500 },
        { expense_id: "exp1", user_id: "U999", display_name: "Bob", share_amount: 1500 },
        { expense_id: "exp2", user_id: USER_ID, display_name: "Alice", share_amount: 750 },
        { expense_id: "exp2", user_id: "U999", display_name: "Bob", share_amount: 750 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({ groupId: GROUP_ID, tripId: TRIP_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalAmount).toBe(4500);
    expect(body.expenses).toHaveLength(2);
    // Route orders by created_at desc — Taxi (2026-05-02) is newer than Dinner (2026-05-01).
    expect(body.expenses[0].description).toBe("Taxi");
    expect(body.expenses[0].amount).toBe(1500);
    expect(body.expenses[1].description).toBe("Dinner");
    expect(body.expenses[1].amount).toBe(3000);

    // Alice paid 3000 + 0 = 3000, spent 1500 + 750 = 2250 → net +750
    // Bob paid 0 + 1500 = 1500, spent 1500 + 750 = 2250 → net -750
    expect(body.balances).toHaveLength(2);
    const alice = body.balances.find((b: { displayName: string }) => b.displayName === "Alice");
    const bob = body.balances.find((b: { displayName: string }) => b.displayName === "Bob");
    expect(alice?.net).toBe(750);
    expect(bob?.net).toBe(-750);

    // Settlement: Bob owes Alice 750
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0].from).toBe("Bob");
    expect(body.settlements[0].to).toBe("Alice");
    expect(body.settlements[0].amount).toBe(750);
  });

  it("scopes expenses to tripId when provided", async () => {
    const OTHER_TRIP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const db = createMockDb({
      expenses: [
        {
          id: "exp1",
          group_id: GROUP_ID,
          trip_id: TRIP_ID,
          paid_by_user_id: USER_ID,
          paid_by_display_name: "Alice",
          amount: 500,
          description: "In-trip expense",
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          id: "exp2",
          group_id: GROUP_ID,
          trip_id: OTHER_TRIP,
          paid_by_user_id: USER_ID,
          paid_by_display_name: "Alice",
          amount: 9999,
          description: "Other trip expense",
          created_at: "2026-04-01T00:00:00Z",
        },
      ],
      expense_splits: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest({ groupId: GROUP_ID, tripId: TRIP_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only the TRIP_ID expense should be returned
    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0].description).toBe("In-trip expense");
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/liff/expenses — validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const req = new NextRequest("http://localhost/api/liff/expenses", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_JSON");
  });

  it("returns 400 when required fields are missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(makePostRequest({ groupId: GROUP_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when amount is negative", async () => {
    const db = createMockDb({ group_members: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(
      makePostRequest({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        displayName: "Alice",
        amount: -100,
        description: "Bad",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is empty", async () => {
    const db = createMockDb({ group_members: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(
      makePostRequest({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        displayName: "Alice",
        amount: 1000,
        description: "",
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/liff/expenses — record expense", () => {
  it("creates expense and splits among all group members", async () => {
    const db = createMockDb({
      group_members: [
        { group_id: GROUP_ID, line_user_id: USER_ID, display_name: "Alice", left_at: null },
        { group_id: GROUP_ID, line_user_id: "U002", display_name: "Bob", left_at: null },
        { group_id: GROUP_ID, line_user_id: "U003", display_name: "Carol", left_at: null },
      ],
      expenses: [],
      expense_splits: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(
      makePostRequest({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        displayName: "Alice",
        amount: 3000,
        description: "Dinner at Nanbantei",
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();

    // Verify expense was inserted
    const expenses = db._tables.get("expenses") ?? [];
    expect(expenses).toHaveLength(1);
    expect(expenses[0].description).toBe("Dinner at Nanbantei");
    expect(Number(expenses[0].amount)).toBe(3000);

    // Verify splits were created for all 3 members
    const splits = db._tables.get("expense_splits") ?? [];
    expect(splits).toHaveLength(3);
    const splitAmounts = splits.map((s) => Number(s.share_amount));
    // 3000 / 3 = 1000 each
    expect(splitAmounts).toContain(1000);
  });

  it("includes the payer if not in group_members list", async () => {
    const db = createMockDb({
      group_members: [
        // Only Bob is in the DB, Alice (payer) is not
        { group_id: GROUP_ID, line_user_id: "U002", display_name: "Bob", left_at: null },
      ],
      expenses: [],
      expense_splits: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(
      makePostRequest({
        groupId: GROUP_ID,
        tripId: TRIP_ID,
        displayName: "Alice",
        amount: 2000,
        description: "Hotel deposit",
      })
    );

    expect(res.status).toBe(201);
    const splits = db._tables.get("expense_splits") ?? [];
    // 2 splits: Bob + Alice (payer fallback)
    expect(splits).toHaveLength(2);
    const userIds = splits.map((s) => s.user_id);
    expect(userIds).toContain(USER_ID);
    expect(userIds).toContain("U002");
  });

  it("accepts null tripId", async () => {
    const db = createMockDb({
      group_members: [
        { group_id: GROUP_ID, line_user_id: USER_ID, display_name: "Alice", left_at: null },
      ],
      expenses: [],
      expense_splits: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(
      makePostRequest({
        groupId: GROUP_ID,
        tripId: null,
        displayName: "Alice",
        amount: 500,
        description: "Snacks",
      })
    );

    expect(res.status).toBe(201);
    const expenses = db._tables.get("expenses") ?? [];
    expect(expenses[0].trip_id).toBeNull();
  });
});
