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
    await reply("無法辨識你的群組，請再試一次。");
    return;
  }

  if (args.length === 0) {
    await reply(
      "用法：/budget [金額] [貨幣]\n" +
        "範例：\n  /budget 50000\n  /budget 50000 JPY\n  /budget 2000 USD"
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
    await reply("只有旅程主辦人可以設定預算。");
    return;
  }

  // Parse amount
  const rawAmount = args[0].replace(/,/g, "");
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount <= 0) {
    await reply("請提供有效的正數金額。範例：/budget 50000");
    return;
  }

  // Parse optional currency
  let currency = "TWD";
  if (args[1]) {
    const cand = args[1].toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(cand)) {
      await reply(
        `不支援的貨幣「${args[1]}」。可用：${[...SUPPORTED_CURRENCIES].join("、")}`
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
    await reply("目前沒有進行中的旅程。請使用 /start [目的地] [日期] 建立旅程。");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ budget_amount: amount, budget_currency: currency })
    .eq("id", trip.id);

  if (error) {
    await reply("設定預算失敗，請再試一次。");
    return;
  }

  await track("budget_set", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { amount, currency, trip_id: trip.id },
  });

  const prev = trip.budget_amount
    ? `先前：${Number(trip.budget_amount).toLocaleString()} ${trip.budget_currency}\n\n`
    : "";

  await reply(
    `已為「${trip.destination_name ?? "這趟旅程"}」設定預算！\n\n` +
      `${prev}總預算：${amount.toLocaleString()} ${currency}\n\n` +
      `用 /exp 記錄支出，用 /exp-summary 查看總覽。`
  );
}
