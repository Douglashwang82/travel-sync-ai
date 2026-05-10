import { createAdminClient } from "@/lib/db";
import { getExpenseSummary } from "@/services/expenses";
import type { CommandContext } from "../router";

export async function handleExpSummary(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("這個指令只能在群組聊天中使用。");
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
    await reply("還沒有記錄任何費用。\n使用 /exp 記下一筆支出。");
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

  lines.push(`💰 費用總覽`);
  lines.push(`總支出：${summary.totalAmount.toLocaleString()}`);

  if (budget) {
    const remaining = budget.amount - summary.totalAmount;
    const pct = Math.min(Math.round((summary.totalAmount / budget.amount) * 100), 100);
    const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
    lines.push(`預算：${summary.totalAmount.toLocaleString()} / ${budget.amount.toLocaleString()} ${budget.currency}（${pct}%）`);
    lines.push(`[${bar}]`);
    if (remaining < 0) {
      lines.push(`⚠️ 已超出預算 ${Math.abs(remaining).toLocaleString()} ${budget.currency}`);
    } else {
      lines.push(`剩餘：${remaining.toLocaleString()} ${budget.currency}`);
    }
  }
  lines.push(``);

  // Balances section
  lines.push(`📊 結餘`);
  for (const b of summary.balances) {
    const sign = b.net > 0 ? "+" : "";
    const label = b.net > 0 ? "應收" : "應付";
    lines.push(`  ${b.displayName}：${sign}$${Math.abs(b.net).toLocaleString()}（${label}）`);
  }

  lines.push(``);

  // Settlements section
  if (summary.settlements.length === 0) {
    lines.push(`✅ 大家都已結清！`);
  } else {
    lines.push(`💸 結算建議`);
    for (const s of summary.settlements) {
      lines.push(`  ${s.from} → ${s.to}：$${s.amount.toLocaleString()}`);
    }
  }

  return lines.join("\n");
}
