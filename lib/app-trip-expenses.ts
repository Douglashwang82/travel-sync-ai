import { createAdminClient } from "@/lib/db";
import { getExpenseSummary, isMissingExpenseSchemaError } from "@/services/expenses";

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

export async function loadTripExpensesForUser(
  tripId: string,
  lineUserId: string
): Promise<AppExpensesResponse | null> {
  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();

  if (!trip) return null;

  const { data: membership } = await db
    .from("group_members")
    .select("line_user_id")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .single();

  if (!membership) return null;

  return loadTripExpensesForGroup(tripId, trip.group_id);
}

export async function loadTripExpensesForGroup(
  tripId: string,
  groupId: string
): Promise<AppExpensesResponse> {
  const db = createAdminClient();

  let budgetAmount: number | null = null;
  let budgetCurrency = "TWD";
  const { data: tripRow, error: tripError } = await db
    .from("trips")
    .select("budget_amount, budget_currency")
    .eq("id", tripId)
    .single();

  if (tripError) {
    console.error("Failed to load trip budget for expenses", {
      tripId,
      groupId,
      error: tripError,
    });
  } else if (tripRow) {
    budgetAmount = tripRow.budget_amount != null ? Number(tripRow.budget_amount) : null;
    budgetCurrency = (tripRow.budget_currency as string) || "TWD";
  }

  const { data: rows, error } = await db
    .from("expenses")
    .select("id, description, amount, paid_by_display_name, created_at")
    .eq("group_id", groupId)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingExpenseSchemaError(error)) {
      return {
        totalAmount: 0,
        budgetAmount,
        budgetCurrency,
        expenses: [],
        balances: [],
        settlements: [],
      };
    }
    console.error("Failed to load trip expense rows", {
      tripId,
      groupId,
      error,
    });
    throw new Error("Failed to load expenses");
  }

  const expenses: AppExpenseRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    amount: Number(r.amount),
    paidByDisplayName: (r.paid_by_display_name as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  try {
    const summary = await getExpenseSummary(groupId, tripId);

    return {
      totalAmount: summary.totalAmount,
      budgetAmount,
      budgetCurrency,
      expenses,
      balances: summary.balances,
      settlements: summary.settlements,
    };
  } catch (summaryError) {
    console.error("Failed to calculate trip expense summary", {
      tripId,
      groupId,
      error: summaryError,
    });
  }

  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return {
    totalAmount: Math.round(totalAmount * 100) / 100,
    budgetAmount,
    budgetCurrency,
    expenses,
    balances: [],
    settlements: [],
  };
}
