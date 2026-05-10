import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";
import { getReadinessSnapshot } from "@/services/readiness";

export async function handleReady(
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

  const snapshot = await getReadinessSnapshot(trip.id);
  if (!snapshot) {
    await reply("目前還無法產生這趟旅程的就緒度摘要。");
    return;
  }

  const intro =
    snapshot.confidenceScore < 50
      ? `目前只有部分已確認的旅程細節（信心度 ${snapshot.confidenceScore}%）。`
      : `這份就緒度摘要僅根據已確認的旅程細節（信心度 ${snapshot.confidenceScore}%）。`;

  const completed = snapshot.items.filter((item) => item.status === "completed");
  // Separate "open" (decided, not booked) from other blockers so bookings stand out
  const bookingNeeded = snapshot.blockers.filter((item) => item.status === "open");
  const otherBlockers = snapshot.blockers
    .filter((item) => item.status !== "open")
    .slice(0, 3);
  const missingInputs = snapshot.missingInputs
    .filter((input) => !input.toLowerCase().includes("booking"))
    .slice(0, 3);
  const bookingInputs = snapshot.missingInputs.filter((input) =>
    input.toLowerCase().includes("booking")
  );

  const lines = [
    `就緒度 - ${snapshot.trip.destinationName}`,
    intro,
    `完成度：${snapshot.completionPercent}%`,
  ];

  // Surface unbooked items first — most actionable gap
  if (bookingNeeded.length > 0) {
    lines.push("", "⚠️ 已決定但尚未預訂：");
    lines.push(...bookingNeeded.map((item) => `- ${item.title}`));
    lines.push(...bookingInputs.map((input) => `  ${input}`));
  }

  lines.push(
    "",
    "已確認的依據：",
    ...(snapshot.committedSourceSummary.length > 0
      ? snapshot.committedSourceSummary.map((entry) => `- ${entry}`)
      : ["- 還沒有任何已確認的執行細節。"]),
    "",
    "已完成：",
    ...(completed.length > 0
      ? completed.map((item) => `- ${item.title}`)
      : ["- 還沒有完全確認的項目。"])
  );

  if (otherBlockers.length > 0) {
    lines.push("", "需要處理：");
    lines.push(...otherBlockers.map((item) => `- ${item.title}：${item.description}`));
  }

  if (missingInputs.length > 0) {
    lines.push("", "建議下一步補充：");
    lines.push(...missingInputs.map((item) => `- ${item}`));
  }

  lines.push("", "這份摘要只根據已確認的內容，不會使用未確認的規劃想法。");

  await reply(lines.join("\n"));
}
