import type { CommandContext } from "../router";

// Stub for /plan — survey-driven trip generation.
// See design/trip-generation.md. Wires through services/trip-generation
// and the survey| postback branch in services/event-processor.ts.

export async function handlePlan(
  _args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("我無法在這裡開始問答，請在 LINE 群組中再試一次。");
    return;
  }

  await reply(
    "/plan 正在開發中：我會用幾個必選問題幫你產生旅程草稿。\n" +
      "暫時可以用 /start 快速建立旅程。"
  );
}
