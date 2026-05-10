import { createAdminClient } from "@/lib/db";
import { confirmBooking } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

/**
 * /booked [item name] [confirmation ref]
 *
 * Marks a confirmed decision item as booked and attaches the confirmation
 * reference (booking number, URL, or any identifier).
 *
 * The last whitespace-separated token is treated as the confirmation ref;
 * everything before it is the item name used to fuzzy-match against confirmed
 * items that still have booking_status = 'needed'.
 *
 * Examples:
 *   /booked hotel AX-12345
 *   /booked osaka hotel https://booking.com/confirm/abc
 *   /booked 餐廳 RES-888
 */
export async function handleBooked(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (args.length < 2 || !ctx.dbGroupId || !ctx.userId) {
    await reply(
      "用法：/booked [項目名稱] [訂位代碼]\n" +
        "範例：/booked hotel AX-12345\n\n" +
        "使用 /status 查看尚未預訂的項目。"
    );
    return;
  }

  const bookingRef = args[args.length - 1];
  const itemQuery = args.slice(0, -1).join(" ");

  const db = createAdminClient();

  // Resolve the active trip for this group
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有進行中的旅程。請使用 /start 建立旅程。");
    return;
  }

  // Find confirmed decision items that still need booking, fuzzy-matched by title
  const { data: candidates } = await db
    .from("trip_items")
    .select("id, title, item_type")
    .eq("trip_id", trip.id)
    .eq("stage", "confirmed")
    .eq("booking_status", "needed")
    .ilike("title", `%${itemQuery}%`);

  if (!candidates?.length) {
    // Check if there are any needing booking at all, to give a better hint
    const { data: allPending } = await db
      .from("trip_items")
      .select("title")
      .eq("trip_id", trip.id)
      .eq("stage", "confirmed")
      .eq("booking_status", "needed");

    if (!allPending?.length) {
      await reply(
        `目前沒有等待預訂確認的項目。所有已確認的決定不是已經預訂，就是不需要預訂。\n\n使用 /status 查看完整看板。`
      );
    } else {
      const list = allPending.map((i) => `• ${i.title}`).join("\n");
      await reply(
        `在尚需預訂的項目中找不到符合「${itemQuery}」的結果。\n\n尚未預訂的項目：\n${list}\n\n請嘗試：/booked [完整項目名稱] [訂位代碼]`
      );
    }
    return;
  }

  // If multiple matches, pick the closest (shortest title = most specific match)
  const target =
    candidates.length === 1
      ? candidates[0]
      : candidates.sort((a, b) => a.title.length - b.title.length)[0];

  const result = await confirmBooking({
    itemId: target.id,
    bookingRef,
    bookedByLineUserId: ctx.userId,
  });

  if (!result.ok) {
    if (result.code === "ALREADY_BOOKED") {
      await reply(`「${target.title}」已經標記為已預訂。`);
    } else {
      await reply(`記錄「${target.title}」的預訂失敗，請再試一次。`);
    }
    return;
  }

  await track("booking_confirmed", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      item_id: target.id,
      item_type: target.item_type,
      has_ref: !!bookingRef,
    },
  });

  await reply(
    `✅ 已確認預訂「${target.title}」！\n` +
      `訂位代碼：${bookingRef}\n\n` +
      `這個項目已經在旅程看板上完成預訂。`
  );
}
