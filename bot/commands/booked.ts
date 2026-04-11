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
      "Usage: /booked [item name] [confirmation ref]\n" +
        "Example: /booked hotel AX-12345\n\n" +
        "Use /status to see items that still need booking."
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
    await reply("No active trip found. Use /start to create one.");
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
        `No items are waiting for a booking confirmation right now. All confirmed decisions are either already booked or don't need a booking.\n\nUse /status to see the full board.`
      );
    } else {
      const list = allPending.map((i) => `• ${i.title}`).join("\n");
      await reply(
        `Couldn't find a match for "${itemQuery}" among items needing booking.\n\nItems still needing booking:\n${list}\n\nTry: /booked [exact item name] [ref]`
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
      await reply(`"${target.title}" is already marked as booked.`);
    } else {
      await reply(`Failed to record booking for "${target.title}". Please try again.`);
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
    `✅ Booking confirmed for "${target.title}"!\n` +
      `Ref: ${bookingRef}\n\n` +
      `This item is now fully booked on the trip board.`
  );
}
