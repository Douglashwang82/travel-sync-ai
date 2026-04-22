import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import {
  recordExpense,
  getExpenseSummary,
  getAllMemberBeneficiaries,
} from "@/services/expenses";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface AppExpenseRow {
  id: string;
  description: string;
  amount: number;
  paidByDisplayName: string | null;
  createdAt: string;
}

export interface AppExpensesResponse {
  totalAmount: number;
  budgetAmount: number | null;
  budgetCurrency: string;
  expenses: AppExpenseRow[];
  balances: Array<{ displayName: string; net: number }>;
  settlements: Array<{ from: string; to: string; amount: number }>;
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  let budgetAmount: number | null = null;
  let budgetCurrency = "TWD";
  const { data: tripRow } = await db
    .from("trips")
    .select("budget_amount, budget_currency")
    .eq("id", tripId)
    .single();
  if (tripRow) {
    budgetAmount = tripRow.budget_amount != null ? Number(tripRow.budget_amount) : null;
    budgetCurrency = (tripRow.budget_currency as string) || "TWD";
  }

  const { data: rows, error } = await db
    .from("expenses")
    .select("id, description, amount, paid_by_display_name, created_at")
    .eq("group_id", auth.groupId)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load expenses", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const expenses: AppExpenseRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    amount: Number(r.amount),
    paidByDisplayName: (r.paid_by_display_name as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  const summary = await getExpenseSummary(auth.groupId, tripId);

  return NextResponse.json<AppExpensesResponse>({
    totalAmount: summary.totalAmount,
    budgetAmount,
    budgetCurrency,
    expenses,
    balances: summary.balances,
    settlements: summary.settlements,
  });
}

const PostSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
});

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: me } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", auth.groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();

  const displayName = (me?.display_name as string | null) ?? auth.lineUserId;

  const beneficiaries = await getAllMemberBeneficiaries(auth.groupId);
  if (!beneficiaries.some((b) => b.userId === auth.lineUserId)) {
    beneficiaries.push({ userId: auth.lineUserId, displayName });
  }

  try {
    const { id } = await recordExpense({
      groupId: auth.groupId,
      tripId,
      paidByUserId: auth.lineUserId,
      paidByDisplayName: displayName,
      amount: parsed.data.amount,
      description: parsed.data.description,
      beneficiaries,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to record expense",
        code: "DB_ERROR",
      },
      { status: 500 }
    );
  }
}
