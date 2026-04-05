import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

// Cool-down: don't nudge the same group more than once per hour
const NUDGE_COOLDOWN_HOURS = 1;

export async function handleNudge(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.lineGroupId) {
    await reply("No active trip found.");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start to create one.");
    return;
  }

  // Check cool-down: look for a nudge_sent event in the last hour
  const cooldownThreshold = new Date(
    Date.now() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: recentNudge } = await db
    .from("analytics_events")
    .select("id")
    .eq("event_name", "nudge_sent")
    .eq("group_id", ctx.dbGroupId)
    .gte("created_at", cooldownThreshold)
    .limit(1)
    .single();

  if (recentNudge) {
    await reply(
      "I already sent a nudge recently. Give your group a bit more time before nudging again."
    );
    return;
  }

  // Find pending items with open votes
  const { data: pendingItems } = await db
    .from("trip_items")
    .select("id, title")
    .eq("trip_id", trip.id)
    .eq("stage", "pending");

  // Find stale todo items (older than 48 hours)
  const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: staleItems } = await db
    .from("trip_items")
    .select("id, title")
    .eq("trip_id", trip.id)
    .eq("stage", "todo")
    .lte("updated_at", staleThreshold);

  if (!pendingItems?.length && !staleItems?.length) {
    await reply("Everything looks good! No pending votes or stale items.");
    return;
  }

  const lines: string[] = [`📣 Trip update for ${trip.destination_name}:`];

  if (pendingItems?.length) {
    lines.push(`\n⏳ Still waiting for votes on:`);
    pendingItems.forEach((item) => lines.push(`  • ${item.title}`));
  }

  if (staleItems?.length) {
    lines.push(`\n📌 These items haven't been discussed yet:`);
    staleItems.forEach((item) => lines.push(`  • ${item.title}`));
  }

  lines.push(`\nType /status to view the full board.`);

  const nudgeMessage = lines.join("\n");

  await pushText(ctx.lineGroupId, nudgeMessage);

  await track("nudge_sent", {
    groupId: ctx.dbGroupId,
    properties: {
      pending_count: pendingItems?.length ?? 0,
      stale_count: staleItems?.length ?? 0,
    },
  });

  await reply("Nudge sent to the group!");
}
