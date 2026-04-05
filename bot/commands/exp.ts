import { createAdminClient } from "@/lib/db";
import {
  recordExpense,
  resolveBeneficiaries,
  getAllMemberBeneficiaries,
} from "@/services/expenses";
import type { CommandContext } from "../router";

const USAGE = `Usage: /exp [amount] [description] [for @name1 @name2 | for all]
Examples:
  /exp 1200 dinner
  /exp 3500 hotel for all
  /exp 600 taxi for @Alice @Bob`;

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
    await reply("This command must be used inside a group chat.");
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

  const payerName = payerMember?.display_name ?? "You";

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
    await reply("Failed to record the expense. Please try again.");
    return;
  }

  const share = Math.round((amount / beneficiaries.length) * 100) / 100;
  const namesStr =
    beneficiaries.length <= 4
      ? beneficiaries.map((b) => b.displayName).join(", ")
      : `${beneficiaries.length} people`;

  await reply(
    `💰 Recorded!\n\n` +
      `${payerName} paid $${amount.toLocaleString()} for ${description}\n` +
      `Split among: ${namesStr}\n` +
      `Each owes: $${share.toLocaleString()}\n\n` +
      `Use /exp-summary to see who owes what.`
  );
}
