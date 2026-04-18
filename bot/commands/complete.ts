import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { getExpenseSummary } from "@/services/expenses";
import type { CommandContext } from "../router";

export async function handleComplete(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("I couldn't identify your group. Please try again.");
    return;
  }

  const db = createAdminClient();

  const { data: membership } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  if (!membership || membership.role !== "organizer") {
    await reply("Only the trip organizer can mark the trip as complete.");
    return;
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("There's no active trip to mark as complete.");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", trip.id);

  if (error) {
    logger.error("complete trip failed", { groupId: ctx.dbGroupId ?? undefined, userId: ctx.userId });
    await reply("Something went wrong completing the trip. Please try again.");
    return;
  }

  await track("trip_completed", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { destination: trip.destination_name },
  });

  await reply(
    `🏁 Trip to ${trip.destination_name} is now complete!\n\n` +
      `Calculating final expenses...`
  );

  // Push final settlement summary
  const summary = await getExpenseSummary(ctx.dbGroupId, trip.id).catch(() => null);
  if (summary && summary.totalAmount > 0) {
    const lines: string[] = [`💰 Final Settlement — ${trip.destination_name}`];
    lines.push(`Total spent: ${summary.totalAmount.toLocaleString()}`);
    lines.push(``);

    if (summary.settlements.length === 0) {
      lines.push(`✅ Everyone is even! No transfers needed.`);
    } else {
      lines.push(`💸 Please complete these transfers:`);
      for (const s of summary.settlements) {
        lines.push(`  ${s.from} → ${s.to}: $${s.amount.toLocaleString()}`);
      }
      lines.push(``);
      lines.push(`Once you've paid, confirm with your group. Thanks for traveling together!`);
    }

    await pushText(ctx.lineGroupId, lines.join("\n"));
  }

  // Send NPS feedback DM to all members
  const { data: members } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("group_id", ctx.dbGroupId)
    .is("left_at", null);

  const npsMessage =
    `👋 Hi! Thanks for using TravelSync AI for your trip to ${trip.destination_name}.\n\n` +
    `How was your experience? Reply with a number:\n` +
    `1-4 😞 Poor · 5-6 😐 OK · 7-8 🙂 Good · 9-10 🤩 Excellent\n\n` +
    `Your feedback helps us improve. (This is a one-time message.)`;

  for (const member of members ?? []) {
    await pushText(member.line_user_id, npsMessage, ctx.dbGroupId).catch(() => {
      // DMs may fail if the user hasn't started a 1:1 chat with the bot — ignore silently
    });
  }
}
