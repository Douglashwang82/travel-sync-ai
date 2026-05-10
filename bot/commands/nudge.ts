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
    await reply("目前沒有進行中的旅程。");
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
    await reply("目前沒有進行中的旅程。請使用 /start 建立旅程。");
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
      "我剛剛已經提醒過了，請再給群組一點時間，稍後再提醒。"
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
    await reply("目前看起來都很好！沒有待投票或停滯的項目。");
    return;
  }

  const lines: string[] = [
    `📣 ${trip.destination_name ?? "這趟旅程"}的進度提醒：`,
  ];

  if (pendingItems?.length) {
    lines.push(`\n⏳ 仍在等待投票：`);
    pendingItems.forEach((item) => lines.push(`  • ${item.title}`));
  }

  if (staleItems?.length) {
    lines.push(`\n📌 這些項目還沒被討論：`);
    staleItems.forEach((item) => lines.push(`  • ${item.title}`));
  }

  lines.push(`\n輸入 /status 查看完整看板。`);

  const nudgeMessage = lines.join("\n");

  await pushText(ctx.lineGroupId, nudgeMessage);

  await track("nudge_sent", {
    groupId: ctx.dbGroupId,
    properties: {
      pending_count: pendingItems?.length ?? 0,
      stale_count: staleItems?.length ?? 0,
    },
  });

  await reply("已將提醒送到群組！");
}
