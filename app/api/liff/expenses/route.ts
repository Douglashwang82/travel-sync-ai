import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest, requireGroupMembership, requireTripMembership } from "@/lib/liff-server";
import {
  recordExpense,
  getExpenseSummary,
  getAllMemberBeneficiaries,
} from "@/services/expenses";
import type { ApiError } from "@/lib/types";

// ─── GET /api/liff/expenses ───────────────────────────────────────────────────
// Returns expense list + settlement summary for a group/trip.
//
// Query params:
//   groupId  (UUID)  — internal DB group id
//   tripId   (UUID)  — optional, scope to this trip

const GetSchema = z.object({
  groupId: z.string().uuid(),
  tripId: z.string().uuid().optional(),
});

export interface ExpenseRow {
  id: string;
  description: string;
  amount: number;
  paid_by_display_name: string | null;
  created_at: string;
}

export interface ExpensesResponse {
  totalAmount: number;
  budgetAmount: number | null;
  budgetCurrency: string;
  expenses: ExpenseRow[];
  balances: Array<{ displayName: string; net: number }>;
  settlements: Array<{ from: string; to: string; amount: number }>;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const parsed = GetSchema.safeParse({
    groupId: searchParams.get("groupId") ?? undefined,
    tripId: searchParams.get("tripId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { groupId, tripId } = parsed.data;
  const membership = tripId
    ? await requireTripMembership(req, tripId)
    : await requireGroupMembership(req, groupId);
  if (!membership.ok) return membership.response;
  const db = createAdminClient();

  // Fetch expense rows
  // Fetch trip budget if tripId is provided
  let budgetAmount: number | null = null;
  let budgetCurrency = "TWD";
  if (tripId) {
    const { data: trip } = await db
      .from("trips")
      .select("budget_amount, budget_currency")
      .eq("id", tripId)
      .single();
    if (trip) {
      budgetAmount = trip.budget_amount != null ? Number(trip.budget_amount) : null;
      budgetCurrency = (trip.budget_currency as string) || "TWD";
    }
  }

  let query = db
    .from("expenses")
    .select("id, description, amount, paid_by_display_name, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (tripId) query = query.eq("trip_id", tripId);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json<ApiError>(
      { error: "Failed to fetch expenses", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const expenses: ExpenseRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    amount: Number(r.amount),
    paid_by_display_name: r.paid_by_display_name as string | null,
    created_at: r.created_at as string,
  }));

  // Reuse existing summary service
  const summary = await getExpenseSummary(groupId, tripId ?? null);

  return NextResponse.json<ExpensesResponse>({
    totalAmount: summary.totalAmount,
    budgetAmount,
    budgetCurrency,
    expenses,
    balances: summary.balances,
    settlements: summary.settlements,
  });
}

// ─── POST /api/liff/expenses ──────────────────────────────────────────────────
// Record a new shared expense, split among all group members by default.
//
// Body:
//   groupId       (UUID)
//   tripId        (UUID | null)
//   displayName   (string)  — payer's display name
//   amount        (number)  — positive
//   description   (string)

const PostSchema = z.object({
  groupId: z.string().uuid(),
  tripId: z.string().uuid().nullable().default(null),
  displayName: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { groupId, tripId, displayName, amount, description } =
    parsed.data;

  const membership = tripId
    ? await requireTripMembership(req, tripId)
    : await requireGroupMembership(req, groupId);
  if (!membership.ok) return membership.response;

  const lineUserId = auth.lineUserId;

  // Split among all current group members
  const beneficiaries = await getAllMemberBeneficiaries(groupId);

  // If the payer isn't in the member list (edge case), include them
  if (!beneficiaries.some((b) => b.userId === lineUserId)) {
    beneficiaries.push({ userId: lineUserId, displayName });
  }

  try {
    const { id } = await recordExpense({
      groupId,
      tripId,
      paidByUserId: lineUserId,
      paidByDisplayName: displayName,
      amount,
      description,
      beneficiaries,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json<ApiError>(
      {
        error: err instanceof Error ? err.message : "Failed to record expense",
        code: "DB_ERROR",
      },
      { status: 500 }
    );
  }
}
