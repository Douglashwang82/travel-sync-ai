import { createAdminClient } from "@/lib/db";
import { getExpenseSummary } from "@/services/expenses";
import type { CommandContext } from "../router";

export async function handleExpSummary(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("This command must be used inside a group chat.");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, budget_amount, budget_currency")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  const summary = await getExpenseSummary(ctx.dbGroupId, trip?.id ?? null);

  if (summary.totalAmount === 0) {
    await reply("No expenses recorded yet.\nUse /exp to log a payment.");
    return;
  }

  const budget = trip?.budget_amount != null
    ? { amount: Number(trip.budget_amount), currency: trip.budget_currency as string || "TWD" }
    : null;

  await reply(buildSummaryMessage(summary, budget));
}

function buildSummaryMessage(
  summary: Awaited<ReturnType<typeof getExpenseSummary>>,
  budget: { amount: number; currency: string } | null
): string {
  const lines: string[] = [];

  lines.push(`💰 Expense Summary`);
  lines.push(`Total spent: ${summary.totalAmount.toLocaleString()}`);

  if (budget) {
    const remaining = budget.amount - summary.totalAmount;
    const pct = Math.min(Math.round((summary.totalAmount / budget.amount) * 100), 100);
    const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
    lines.push(`Budget: ${summary.totalAmount.toLocaleString()} / ${budget.amount.toLocaleString()} ${budget.currency} (${pct}%)`);
    lines.push(`[${bar}]`);
    if (remaining < 0) {
      lines.push(`⚠️ Over budget by ${Math.abs(remaining).toLocaleString()} ${budget.currency}`);
    } else {
      lines.push(`Remaining: ${remaining.toLocaleString()} ${budget.currency}`);
    }
  }
  lines.push(``);

  // Balances section
  lines.push(`📊 Balances`);
  for (const b of summary.balances) {
    const sign = b.net > 0 ? "+" : "";
    const label = b.net > 0 ? "is owed" : "owes";
    lines.push(`  ${b.displayName}: ${sign}$${Math.abs(b.net).toLocaleString()} (${label})`);
  }

  lines.push(``);

  // Settlements section
  if (summary.settlements.length === 0) {
    lines.push(`✅ Everyone is even!`);
  } else {
    lines.push(`💸 Settlements`);
    for (const s of summary.settlements) {
      lines.push(`  ${s.from} → ${s.to}: $${s.amount.toLocaleString()}`);
    }
  }

  return lines.join("\n");
}
