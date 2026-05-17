import { createAdminClient } from "@/lib/db";
import { pushText, pushFlex } from "@/lib/line";
import { track } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { routeCommand } from "@/bot/router";
import { parseMessage } from "@/services/parsing";
import { handleDirectMessage } from "@/services/private-chat";
import { castVote, closeVote } from "@/services/vote";
import { refreshVoteCarousel, announceWinner } from "@/services/decisions";
import {
  getSession,
  recordAnswer,
  abandonSurvey,
  markGenerated,
  markForked,
  generateTemplateFromSurvey,
  GenerationFailedError,
  type SurveySession,
} from "@/services/trip-generation";
import {
  buildQuestionBubble,
  buildPreviewBubble,
} from "@/services/trip-generation/flex";
import { forkTemplate } from "@/services/templates";
import type { SurveyQuestionKey } from "@/services/trip-generation";

interface EventContext {
  dbGroupId: string | null;
  lineGroupId: string | undefined;
  userId: string | undefined;
  replyToken: string | undefined;
  messageText: string | undefined;
}

/**
 * Process a persisted LINE event asynchronously.
 * Called fire-and-forget from the webhook route — must never throw uncaught.
 */
export async function processLineEvent(
  lineEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  ctx: EventContext
): Promise<void> {
  const db = createAdminClient();
  logger.info("event start", { eventId: lineEventId, context: eventType, groupId: ctx.dbGroupId ?? undefined });

  // Mark as processing
  await db
    .from("line_events")
    .update({ processing_status: "processing" })
    .eq("id", lineEventId);

  try {
    switch (eventType) {
      case "join":
      case "follow":
        await handleJoin(ctx);
        break;

      case "leave":
        await handleLeave(ctx);
        break;

      case "message":
        await handleMessage(ctx, lineEventId);
        break;

      case "postback":
        await handlePostback(payload, ctx);
        break;

      default:
        logger.warn("unknown event type", { eventId: lineEventId, context: eventType });
        break;
    }

    logger.info("event done", { eventId: lineEventId, context: eventType });
    await db
      .from("line_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", lineEventId);
  } catch (err) {
    logger.error("event failed", { eventId: lineEventId, context: eventType, groupId: ctx.dbGroupId ?? undefined });
    const failureReason = err instanceof Error ? err.message : String(err);

    const { data: row } = await db
      .from("line_events")
      .select("retry_count")
      .eq("id", lineEventId)
      .single();
    const retryCount = row?.retry_count ?? 0;
    const nextRetryAt = computeNextRetryAt(retryCount);

    await db
      .from("line_events")
      .update({
        processing_status: "failed",
        failure_reason: failureReason,
        next_retry_at: nextRetryAt,
      })
      .eq("id", lineEventId);
  }
}

// Exponential backoff for failed-event reprocessing: 2^(n+1) seconds, capped at
// 1 hour. Exported for unit tests.
export function computeNextRetryAt(retryCount: number, now: number = Date.now()): string {
  const seconds = Math.min(Math.pow(2, retryCount + 1), 3600);
  return new Date(now + seconds * 1000).toISOString();
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleJoin(ctx: EventContext): Promise<void> {
  if (!ctx.lineGroupId) {
    logger.warn("handleJoin: missing lineGroupId");
    return;
  }

  await track("bot_added_to_group", {
    groupId: ctx.dbGroupId ?? undefined,
    properties: { line_group_id: ctx.lineGroupId },
  });

  const welcomeMessage =
    "嗨，我是 TravelSync AI，你們的群組旅程規劃助手。\n\n" +
    "開始使用：輸入 /start [目的地] [日期] 建立旅程。\n" +
    "範例：/start Osaka 7/15-7/20\n\n" +
    "輸入 /help 查看所有指令。\n\n" +
    "隱私提醒：我會解析旅遊相關訊息來協助規劃。你可以隨時輸入 /optout 停止解析。";

  await pushText(ctx.lineGroupId, welcomeMessage);
}

async function handleLeave(ctx: EventContext): Promise<void> {
  if (!ctx.dbGroupId) return;

  const db = createAdminClient();
  await db
    .from("line_groups")
    .update({ status: "removed" })
    .eq("id", ctx.dbGroupId);

  await track("bot_removed", { groupId: ctx.dbGroupId });
}

async function handleMessage(ctx: EventContext, lineEventId: string): Promise<void> {
  const { messageText, replyToken, dbGroupId, lineGroupId, userId } = ctx;
  if (!messageText || !lineGroupId) {
    logger.warn("handleMessage: missing messageText or lineGroupId", { groupId: dbGroupId ?? undefined });
    return;
  }

  // Route slash commands immediately (works in both groups and 1:1 DMs)
  if (messageText.startsWith("/")) {
    await routeCommand(messageText, {
      lineGroupId,
      dbGroupId,
      userId,
      replyToken,
    });
    return;
  }

  // Detect 1:1 DM: LINE user IDs start with 'U'; group IDs start with 'C' or 'R'
  const isDm = lineGroupId === userId;
  if (isDm) {
    if (!userId || !replyToken) return;
    await handleDirectMessage(userId, replyToken, messageText);
    return;
  }

  // If a survey is waiting on a free-text answer (destination / must_haves),
  // capture this message instead of routing it through the parsing pipeline.
  if (dbGroupId && userId) {
    const consumed = await tryConsumeAsSurveyAnswer({
      groupId: dbGroupId,
      lineGroupId,
      userId,
      text: messageText,
    });
    if (consumed) return;
  }

  // Non-command messages: run through the LLM parsing pipeline
  if (dbGroupId) {
    await parseMessage({
      messageText,
      groupId: dbGroupId,
      lineGroupId,
      lineEventId,
      lineUserId: userId,
    });
  }
}

async function handlePostback(
  payload: Record<string, unknown>,
  ctx: EventContext
): Promise<void> {
  const postback = payload.postback as Record<string, unknown> | undefined;
  const data = (postback?.data ?? payload.data) as string | undefined;
  if (!data) return;

  // Survey postback scheme: survey|{sessionId}|{questionKey|fork|cancel}|{value?}
  // See design/trip-generation.md.
  if (data.startsWith("survey|")) {
    await handleSurveyPostback(data, ctx);
    return;
  }

  // Vote postback format: vote|{itemId}|{optionId}
  if (data.startsWith("vote|")) {
    const [, itemId, optionId] = data.split("|");
    if (!itemId || !optionId || !ctx.dbGroupId || !ctx.userId || !ctx.lineGroupId) return;

    const result = await castVote({
      tripItemId: itemId,
      optionId,
      groupId: ctx.dbGroupId,
      lineUserId: ctx.userId,
    });

    if (!result.accepted) {
      await pushText(ctx.lineGroupId, result.error ?? "無法記錄你的投票。");
      return;
    }

    if (result.majority.reached && result.majority.winningOptionId) {
      // Close the vote and announce (guard against double-fire on concurrent postbacks)
      const { closed } = await closeVote(itemId, result.majority.winningOptionId, ctx.dbGroupId, result.totalVotes);
      if (closed) {
        await announceWinner(itemId, result.majority.winningOptionId, ctx.lineGroupId, result.majority.winningCount, result.totalVotes);
      }
    } else {
      // Refresh the carousel with updated vote counts
      await refreshVoteCarousel(itemId, ctx.lineGroupId);
    }
  }
}

// ─── Survey ──────────────────────────────────────────────────────────────────

interface SurveyAnswerIntake {
  groupId: string;
  lineGroupId: string;
  userId: string;
  text: string;
}

/**
 * Free-text capture for survey steps that can't be answered via quick-reply
 * (currently `destination` and `must_haves`). Returns true if the message was
 * consumed so the caller skips the parsing pipeline.
 */
async function tryConsumeAsSurveyAnswer(input: SurveyAnswerIntake): Promise<boolean> {
  const db = createAdminClient();
  const { data: sessionRow } = await db
    .from("trip_survey_sessions")
    .select("id, current_step, status")
    .eq("group_id", input.groupId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!sessionRow) return false;

  const step = sessionRow.current_step as SurveyQuestionKey | "done";
  if (step !== "destination" && step !== "must_haves") return false;

  try {
    const session = await recordAnswer(sessionRow.id as string, step, input.text);
    await advanceSurveyOrFinish(session, input.lineGroupId, input.userId, input.groupId);
    return true;
  } catch (err) {
    logger.warn("survey free-text answer rejected", { groupId: input.groupId, error: String(err) });
    await pushText(input.lineGroupId, `輸入無法接受：${err instanceof Error ? err.message : "請再試一次"}`);
    return true; // Still consumed — don't bleed into the parser.
  }
}

async function handleSurveyPostback(data: string, ctx: EventContext): Promise<void> {
  const [, sessionId, action, ...rest] = data.split("|");
  const value = rest.join("|"); // some values may contain "|" (we don't currently, but be safe)
  if (!sessionId || !action) return;
  if (!ctx.lineGroupId || !ctx.userId || !ctx.dbGroupId) return;

  if (action === "cancel") {
    await abandonSurvey(sessionId);
    await pushText(ctx.lineGroupId, "已取消這次旅程草稿。");
    return;
  }

  if (action === "fork") {
    await handleSurveyFork(sessionId, ctx);
    return;
  }

  // Otherwise `action` is a question key.
  try {
    const session = await recordAnswer(sessionId, action as SurveyQuestionKey, value);
    await advanceSurveyOrFinish(session, ctx.lineGroupId, ctx.userId, ctx.dbGroupId);
  } catch (err) {
    logger.warn("survey postback rejected", { groupId: ctx.dbGroupId, error: String(err) });
    await pushText(ctx.lineGroupId, `這個答案無法接受：${err instanceof Error ? err.message : "請再試一次"}`);
  }
}

/**
 * After any answer (postback or free-text), either push the next question or
 * trigger generation. Generation is awaited inline — slow but bounded; if we
 * see >10s p95 we'll move it onto the line_events queue.
 */
async function advanceSurveyOrFinish(
  session: SurveySession,
  lineGroupId: string,
  userId: string,
  dbGroupId: string
): Promise<void> {
  if (session.status !== "in_progress" && session.status !== "generated") return;

  if (session.currentStep !== "done") {
    const bubble = buildQuestionBubble(session.id, session.currentStep);
    await pushFlex(lineGroupId, "AI 旅程草稿問答", bubble, dbGroupId);
    return;
  }

  // current_step === 'done' → run the generator.
  await pushText(lineGroupId, "✨ 正在生成草稿，這可能要 10–30 秒…");

  try {
    const out = await generateTemplateFromSurvey({
      answers: session.answers,
      authorLineUserId: userId,
    });
    await markGenerated(session.id, out.templateId);

    // Pull title/summary back for the preview bubble.
    const db = createAdminClient();
    const { data: ver } = await db
      .from("trip_template_versions")
      .select("title, summary, duration_days, destination_name")
      .eq("id", out.versionId)
      .single();

    const preview = buildPreviewBubble(
      session.id,
      (ver?.title as string) ?? "你的旅程草稿",
      (ver?.summary as string) ?? "",
      (ver?.duration_days as number) ?? (session.answers.duration_days ?? 0),
      (ver?.destination_name as string | null) ?? session.answers.destination ?? null
    );
    await pushFlex(lineGroupId, "AI 旅程草稿完成", preview, dbGroupId);
  } catch (err) {
    if (err instanceof GenerationFailedError) {
      logger.warn("generation failed", { groupId: dbGroupId, reason: err.reason });
      await pushText(lineGroupId, generationFailureMessage(err.reason));
    } else {
      logger.error("generation crashed", { groupId: dbGroupId, error: String(err) });
      await pushText(lineGroupId, "生成失敗，請稍後再試一次。");
    }
  }
}

async function handleSurveyFork(sessionId: string, ctx: EventContext): Promise<void> {
  if (!ctx.lineGroupId || !ctx.userId || !ctx.dbGroupId) return;

  const session = await getSession(sessionId);
  if (!session || !session.templateId) {
    await pushText(ctx.lineGroupId, "找不到對應的草稿，請重新執行 /plan。");
    return;
  }

  const db = createAdminClient();
  const { data: tmpl } = await db
    .from("trip_templates")
    .select("slug")
    .eq("id", session.templateId)
    .single();
  if (!tmpl) {
    await pushText(ctx.lineGroupId, "找不到草稿，請重新執行 /plan。");
    return;
  }

  // Default start date = 14 days from today. Users can edit in the bento.
  const startDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const result = await forkTemplate({
    slug: tmpl.slug as string,
    groupId: ctx.dbGroupId,
    startDate,
    lineUserId: ctx.userId,
  });
  if (!result.ok) {
    await pushText(ctx.lineGroupId, `無法建立旅程：${result.error}`);
    return;
  }

  await markForked(sessionId);
  const tripUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/app/trips/${result.data.tripId}`;
  await pushText(ctx.lineGroupId, `已建立旅程！打開看板開始規劃：\n${tripUrl}`);
}

function generationFailureMessage(reason: GenerationFailedError["reason"]): string {
  switch (reason) {
    case "gemini_unavailable":
      return "AI 服務暫時無法回應，請稍後再試。";
    case "no_candidates":
      return "找不到這個目的地的景點資料，請換一個地點或稍後再試。";
    case "irreparable":
      return "你的條件太緊，AI 無法排出可行的行程。建議放寬節奏或天數後再試。";
    case "invalid_answers":
      return "問答內容不完整，請重新執行 /plan。";
    case "schema_invalid":
    case "persist_failed":
    default:
      return "生成失敗，請稍後再試一次。";
  }
}
