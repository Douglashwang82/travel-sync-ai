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
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  const summary = await getExpenseSummary(ctx.dbGroupId, trip?.id ?? null);

  if (summary.totalAmount === 0) {
    await reply("No expenses recorded yet.\nUse /exp to log a payment.");
    return;
  }

  await reply(buildSummaryMessage(summary));
}

function buildSummaryMessage(
  summary: Awaited<ReturnType<typeof getExpenseSummary>>
): string {
  const lines: string[] = [];

  lines.push(`💰 Expense Summary`);
  lines.push(`Total: $${summary.totalAmount.toLocaleString()}`);
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
