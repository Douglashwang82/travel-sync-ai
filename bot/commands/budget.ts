import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

const SUPPORTED_CURRENCIES = new Set([
  "TWD", "JPY", "USD", "EUR", "GBP", "THB", "SGD", "KRW", "HKD", "AUD", "MYR", "VND", "IDR",
]);

/**
 * /budget [amount] [currency?]
 *
 * Set or update the planned total budget for the active trip.
 * Examples:
 *   /budget 50000
 *   /budget 50000 JPY
 *   /budget 2000 USD
 */
export async function handleBudget(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("I couldn't identify your group. Please try again.");
    return;
  }

  if (args.length === 0) {
    await reply(
      "Usage: /budget [amount] [currency]\n" +
        "Examples:\n  /budget 50000\n  /budget 50000 JPY\n  /budget 2000 USD"
    );
    return;
  }

  const db = createAdminClient();

  // Organizer check
  const { data: membership } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  if (!membership || membership.role !== "organizer") {
    await reply("Only the trip organizer can set the budget.");
    return;
  }

  // Parse amount
  const rawAmount = args[0].replace(/,/g, "");
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount <= 0) {
    await reply("Please provide a valid positive amount. Example: /budget 50000");
    return;
  }

  // Parse optional currency
  let currency = "TWD";
  if (args[1]) {
    const cand = args[1].toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(cand)) {
      await reply(
        `Unknown currency "${args[1]}". Supported: ${[...SUPPORTED_CURRENCIES].join(", ")}`
      );
      return;
    }
    currency = cand;
  }

  // Fetch active trip
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, budget_amount, budget_currency")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Start one with /start [destination] [dates].");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ budget_amount: amount, budget_currency: currency })
    .eq("id", trip.id);

  if (error) {
    await reply("Failed to set budget. Please try again.");
    return;
  }

  await track("budget_set", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { amount, currency, trip_id: trip.id },
  });

  const prev = trip.budget_amount
    ? `Previously: ${Number(trip.budget_amount).toLocaleString()} ${trip.budget_currency}\n\n`
    : "";

  await reply(
    `Budget set for ${trip.destination_name}!\n\n` +
      `${prev}Total budget: ${amount.toLocaleString()} ${currency}\n\n` +
      `Expenses are tracked automatically with /exp. View the summary with /exp-summary.`
  );
}
