import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import type { CommandContext } from "../router";

export async function handleCancel(
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
    await reply("Only the trip organizer can cancel the trip.");
    return;
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("There's no active trip to cancel.");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("id", trip.id);

  if (error) {
    logger.error("cancel trip failed", { groupId: ctx.dbGroupId ?? undefined, userId: ctx.userId });
    await reply("Something went wrong cancelling the trip. Please try again.");
    return;
  }

  await track("trip_cancelled", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { destination: trip.destination_name ?? null },
  });

  const label = trip.destination_name ? `Trip to ${trip.destination_name}` : "The trip";
  await reply(
    `${label} has been cancelled.\n\n` +
      `Use /start to plan a new trip whenever you're ready.`
  );
}
