import type { CommandContext } from "../router";
import { pushFlex } from "@/lib/line";
import { startOrResumeSurvey } from "@/services/trip-generation";
import { buildQuestionBubble } from "@/services/trip-generation/flex";

/**
 * /plan — kicks off (or resumes) the trip-generation survey in this group.
 * One in-progress survey per group at a time. Resuming on a second /plan tap
 * is intentional; explicit cancel happens via the `survey|...|cancel` postback
 * on the preview bubble. See design/trip-generation.md.
 */
export async function handlePlan(
  _args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId || !ctx.lineGroupId) {
    await reply("/plan 需要在 LINE 群組中執行。");
    return;
  }

  const session = await startOrResumeSurvey({
    groupId: ctx.dbGroupId,
    startedByUserId: ctx.userId,
  });

  if (session.currentStep === "done") {
    await reply("這個群組目前已有完成的草稿，請查看 App 中的旅程看板。");
    return;
  }

  const bubble = buildQuestionBubble(session.id, session.currentStep);
  await pushFlex(ctx.lineGroupId, "AI 旅程草稿問答", bubble, ctx.dbGroupId);
}
