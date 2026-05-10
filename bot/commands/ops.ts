import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";
import { getOperationsSummary } from "@/services/operations";

export async function handleOps(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const summary = await getOperationsSummary(trip.id);
  if (!summary) {
    await reply("目前還無法產生這趟旅程的營運摘要。");
    return;
  }

  await track("ops_command_used", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      trip_id: trip.id,
      phase: summary.phase,
      degraded: summary.freshness.degraded,
    },
  });

  const lines = [
    `營運狀態 - ${summary.destinationName}`,
    summary.headline,
    "",
    `階段：${summary.phase}`,
    `就緒度：完成 ${summary.readiness.completionPercent}%，信心度 ${summary.readiness.confidenceScore}%`,
    "",
    "下一步行動：",
    ...(summary.nextActions.length > 0
      ? summary.nextActions.map((item) => `- ${item}`)
      : ["- 已確認資料中沒有需要立即處理的事項。"]),
    "",
    "目前的風險：",
    ...(summary.activeRisks.length > 0
      ? summary.activeRisks.map((item) => `- ${item}`)
      : ["- 已確認資料中未發現重大營運風險。"]),
    "",
    "資料新鮮度：",
    ...summary.freshness.notes.map((item) => `- ${item}`),
  ];

  await reply(lines.join("\n"));
}
