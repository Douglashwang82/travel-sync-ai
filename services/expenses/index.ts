import { createAdminClient } from "@/lib/db";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Beneficiary {
  userId: string;
  displayName: string;
}

export interface RecordExpenseInput {
  groupId: string;           // internal UUID
  tripId: string | null;
  paidByUserId: string;      // LINE user ID
  paidByDisplayName: string | null;
  amount: number;
  description: string;
  beneficiaries: Beneficiary[]; // who the amount is split among (including payer if applicable)
}

export interface Settlement {
  from: string;   // display name
  to: string;     // display name
  amount: number; // how much from owes to
}

export interface ExpenseSummary {
  totalAmount: number;
  balances: Array<{ displayName: string; net: number }>;
  settlements: Settlement[];
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

export function isMissingExpenseSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as PostgrestLikeError;
  return (
    maybeError.code === "PGRST205" &&
    typeof maybeError.message === "string" &&
    (maybeError.message.includes("public.expenses") ||
      maybeError.message.includes("public.expense_splits"))
  );
}

// ─── Record ────────────────────────────────────────────────────────────────

/**
 * Persist an expense and its per-person splits.
 * share_amount = amount / beneficiaries.length, last person absorbs rounding.
 */
export async function recordExpense(input: RecordExpenseInput): Promise<{ id: string }> {
  const db = createAdminClient();

  const { data: expense, error: expErr } = await db
    .from("expenses")
    .insert({
      group_id: input.groupId,
      trip_id: input.tripId,
      paid_by_user_id: input.paidByUserId,
      paid_by_display_name: input.paidByDisplayName,
      amount: input.amount,
      description: input.description,
    })
    .select("id")
    .single();

  if (expErr || !expense) {
    if (isMissingExpenseSchemaError(expErr)) {
      throw new Error("Expense tracking is not available until the database migrations are applied.");
    }
    throw new Error(`Failed to insert expense: ${expErr?.message}`);
  }

  const n = input.beneficiaries.length;
  const baseShare = Math.floor((input.amount * 100) / n) / 100; // truncate to 2 dp
  const remainder = Math.round((input.amount - baseShare * n) * 100) / 100;

  const splits = input.beneficiaries.map((b, i) => ({
    expense_id: expense.id,
    user_id: b.userId,
    display_name: b.displayName,
    share_amount: i === n - 1 ? baseShare + remainder : baseShare,
  }));

  const { error: splitErr } = await db.from("expense_splits").insert(splits);
  if (splitErr) {
    if (isMissingExpenseSchemaError(splitErr)) {
      throw new Error("Expense tracking is not available until the database migrations are applied.");
    }
    throw new Error(`Failed to insert splits: ${splitErr.message}`);
  }

  return { id: expense.id };
}

// ─── Summary ───────────────────────────────────────────────────────────────

/**
 * Calculate net balances and simplified settlements for a group.
 * If tripId is provided, scopes to that trip only.
 */
export async function getExpenseSummary(
  groupId: string,
  tripId: string | null
): Promise<ExpenseSummary> {
  const db = createAdminClient();

  let query = db
    .from("expenses")
    .select("id, paid_by_user_id, paid_by_display_name, amount")
    .eq("group_id", groupId);

  if (tripId) query = query.eq("trip_id", tripId);

  const { data: expenseRows, error: expenseError } = await query;
  if (expenseError) {
    if (isMissingExpenseSchemaError(expenseError)) {
      return { totalAmount: 0, balances: [], settlements: [] };
    }
    throw new Error(`Failed to load expenses for summary: ${expenseError.message}`);
  }
  if (!expenseRows?.length) {
    return { totalAmount: 0, balances: [], settlements: [] };
  }

  const expenseIds = expenseRows.map((e) => e.id);
  const totalAmount = expenseRows.reduce((s, e) => s + Number(e.amount), 0);
  const { data: splitRows, error: splitError } = await db
    .from("expense_splits")
    .select("expense_id, user_id, display_name, share_amount")
    .in("expense_id", expenseIds);
  if (splitError) {
    if (isMissingExpenseSchemaError(splitError)) {
      return { totalAmount: round2(totalAmount), balances: [], settlements: [] };
    }
    throw new Error(`Failed to load expense splits: ${splitError.message}`);
  }

  // net[userId] = { displayName, net }  (positive = owed money, negative = owes money)
  const net = new Map<string, { displayName: string; net: number }>();

  const touch = (userId: string, displayName: string) => {
    if (!net.has(userId)) net.set(userId, { displayName, net: 0 });
  };

  // Credit the payer
  for (const e of expenseRows) {
    touch(e.paid_by_user_id, e.paid_by_display_name ?? e.paid_by_user_id);
    net.get(e.paid_by_user_id)!.net += Number(e.amount);
  }

  // Debit each beneficiary their share
  for (const s of splitRows ?? []) {
    touch(s.user_id, s.display_name);
    net.get(s.user_id)!.net -= Number(s.share_amount);
  }

  const balances = [...net.values()]
    .map(({ displayName, net: n }) => ({ displayName, net: round2(n) }))
    .filter((b) => Math.abs(b.net) >= 0.01)
    .sort((a, b) => b.net - a.net);

  const settlements = simplifyDebts(balances);

  return { totalAmount: round2(totalAmount), balances, settlements };
}

// ─── Resolve beneficiaries ────────────────────────────────────────────────

/**
 * Parse the "for ..." clause and resolve display-name mentions to group members.
 *
 * Returns null when "all" is intended (caller should fetch all group members).
 *
 * Input examples:
 *   ["@Alice", "@Bob"]    → match by display name
 *   ["all"]               → null (all members)
 *   []                    → null (default: all members)
 */
export async function resolveBeneficiaries(
  groupId: string,
  mentions: string[]  // raw tokens after "for" keyword, may include @prefix
): Promise<Beneficiary[] | null> {
  if (mentions.length === 0 || mentions[0].toLowerCase() === "all") {
    return null; // caller should use all group members
  }

  const db = createAdminClient();
  const { data: members } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("group_id", groupId)
    .is("left_at", null);

  const memberList = members ?? [];

  const resolved: Beneficiary[] = mentions.map((raw) => {
    const name = raw.replace(/^@/, "").toLowerCase();
    const match = memberList.find(
      (m) => m.display_name?.toLowerCase() === name
    );
    return {
      userId: match?.line_user_id ?? `unresolved_${name}`,
      displayName: match?.display_name ?? raw.replace(/^@/, ""),
    };
  });

  return resolved;
}

/**
 * Fetch all current group members as beneficiaries (for "for all" / default).
 */
export async function getAllMemberBeneficiaries(groupId: string): Promise<Beneficiary[]> {
  const db = createAdminClient();
  const { data: members } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("group_id", groupId)
    .is("left_at", null);

  return (members ?? []).map((m) => ({
    userId: m.line_user_id,
    displayName: m.display_name ?? m.line_user_id,
  }));
}

// ─── Debt simplification ──────────────────────────────────────────────────

/**
 * Greedy minimum-transactions debt simplification.
 * Creditors (net > 0) receive money from debtors (net < 0).
 */
function simplifyDebts(balances: Array<{ displayName: string; net: number }>): Settlement[] {
  const creditors = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net);

  const debtors = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ ...b, net: -b.net })) // flip to positive for easier math
    .sort((a, b) => b.net - a.net);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const amount = round2(Math.min(credit.net, debt.net));

    settlements.push({ from: debt.displayName, to: credit.displayName, amount });

    credit.net = round2(credit.net - amount);
    debt.net = round2(debt.net - amount);

    if (credit.net < 0.01) ci++;
    if (debt.net < 0.01) di++;
  }

  return settlements;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
