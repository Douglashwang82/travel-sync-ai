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
    await reply("無法辨識你的群組，請再試一次。");
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
    await reply("只有旅程主辦人可以將旅程標記為完成。");
    return;
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有可標記為完成的進行中旅程。");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", trip.id);

  if (error) {
    logger.error("complete trip failed", { groupId: ctx.dbGroupId ?? undefined, userId: ctx.userId });
    await reply("完成旅程時發生問題，請再試一次。");
    return;
  }

  await track("trip_completed", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { destination: trip.destination_name },
  });

  await reply(
    `🏁 前往「${(trip.destination_name ?? "目的地")}」的旅程已完成！\n\n` +
      `正在計算最終費用⋯⋯`
  );

  // Push final settlement summary
  const summary = await getExpenseSummary(ctx.dbGroupId, trip.id).catch(() => null);
  if (summary && summary.totalAmount > 0) {
    const lines: string[] = [`💰 最終結算 — ${(trip.destination_name ?? "這趟旅程")}`];
    lines.push(`總支出：${summary.totalAmount.toLocaleString()}`);
    lines.push(``);

    if (summary.settlements.length === 0) {
      lines.push(`✅ 大家都已結清！不需要轉帳。`);
    } else {
      lines.push(`💸 請完成以下轉帳：`);
      for (const s of summary.settlements) {
        lines.push(`  ${s.from} → ${s.to}：$${s.amount.toLocaleString()}`);
      }
      lines.push(``);
      lines.push(`轉帳完成後請和群組確認。謝謝大家一起旅行！`);
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
    `👋 嗨！謝謝你使用 TravelSync AI 規劃前往「${(trip.destination_name ?? "目的地")}」的旅程。\n\n` +
    `這次體驗如何？請回覆一個數字：\n` +
    `1-4 😞 差 · 5-6 😐 普通 · 7-8 🙂 好 · 9-10 🤩 很棒\n\n` +
    `你的回饋能幫助我們進步。（此訊息只會傳送一次。）`;

  for (const member of members ?? []) {
    await pushText(member.line_user_id, npsMessage, ctx.dbGroupId).catch(() => {
      // DMs may fail if the user hasn't started a 1:1 chat with the bot — ignore silently
    });
  }
}
