import { createAdminClient } from "@/lib/db";
import {
  recordExpense,
  resolveBeneficiaries,
  getAllMemberBeneficiaries,
} from "@/services/expenses";
import type { CommandContext } from "../router";

const USAGE = `用法：/exp [金額] [說明] [for @名字1 @名字2 | for all]
範例：
  /exp 1200 晚餐
  /exp 3500 飯店 for all
  /exp 600 計程車 for @Alice @Bob`;

/**
 * Parse the raw arg tokens into { amount, description, forTokens }.
 *
 * "/exp 1200 team dinner for @Alice @Bob"
 *   → { amount: 1200, description: "team dinner", forTokens: ["@Alice", "@Bob"] }
 *
 * "/exp 500 taxi"
 *   → { amount: 500, description: "taxi", forTokens: [] }
 */
function parseArgs(args: string[]): {
  amount: number;
  description: string;
  forTokens: string[];
} | null {
  if (args.length < 2) return null;

  const amount = parseFloat(args[0].replace(/,/g, ""));
  if (isNaN(amount) || amount <= 0) return null;

  // Join remaining tokens then split on the word "for" (whole-word, case-insensitive)
  const rest = args.slice(1).join(" ");
  const forIdx = rest.search(/\bfor\b/i);

  let description: string;
  let forTokens: string[];

  if (forIdx === -1) {
    description = rest.trim();
    forTokens = [];
  } else {
    description = rest.slice(0, forIdx).trim();
    forTokens = rest
      .slice(forIdx + 3)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  if (!description) return null;

  return { amount, description, forTokens };
}

export async function handleExp(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("這個指令只能在群組聊天中使用。");
    return;
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    await reply(USAGE);
    return;
  }

  const { amount, description, forTokens } = parsed;
  const db = createAdminClient();

  // Resolve payer display name
  const { data: payerMember } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .single();

  const payerName = payerMember?.display_name ?? "你";

  // Get active trip (optional — expense can exist without a trip)
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  // Resolve beneficiaries
  let beneficiaries = await resolveBeneficiaries(ctx.dbGroupId, forTokens);
  if (!beneficiaries) {
    // "for all" or no for-clause: split among the whole group
    beneficiaries = await getAllMemberBeneficiaries(ctx.dbGroupId);
  }

  if (beneficiaries.length === 0) {
    // Fallback: just the payer (can happen in empty groups during dev)
    beneficiaries = [{ userId: ctx.userId, displayName: payerName }];
  }

  try {
    await recordExpense({
      groupId: ctx.dbGroupId,
      tripId: trip?.id ?? null,
      paidByUserId: ctx.userId,
      paidByDisplayName: payerName,
      amount,
      description,
      beneficiaries,
    });
  } catch (err) {
    console.error("[exp] recordExpense failed", err);
    await reply("記錄費用失敗，請再試一次。");
    return;
  }

  const share = Math.round((amount / beneficiaries.length) * 100) / 100;
  const namesStr =
    beneficiaries.length <= 4
      ? beneficiaries.map((b) => b.displayName).join("、")
      : `${beneficiaries.length} 人`;

  await reply(
    `💰 已記錄！\n\n` +
      `${payerName} 為「${description}」支付 $${amount.toLocaleString()}\n` +
      `分攤對象：${namesStr}\n` +
      `每人應付：$${share.toLocaleString()}\n\n` +
      `使用 /exp-summary 查看誰欠誰多少。`
  );
}
