import { after } from "next/server";
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
 * Internal event_type used to enqueue heavy work (currently itinerary
 * generation) on the line_events queue. Defined here so the switch
 * statement that dispatches it can reference it before the worker
 * function is declared further down the file.
 */
export const INTERNAL_EVENT_GENERATE_TEMPLATE = "internal:generate_template";

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

      case INTERNAL_EVENT_GENERATE_TEMPLATE:
        await runGenerationJob(payload);
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
 * enqueue the generation job. Generation runs out-of-band on the line_events
 * queue (event_type = INTERNAL_EVENT_GENERATE_TEMPLATE) so the postback
 * handler can return in <1s and a generation failure gets the usual queue
 * retry/backoff for free.
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

  await pushText(lineGroupId, "✨ 正在生成草稿，這可能要 10–30 秒…");
  await enqueueGenerationJob({ sessionId: session.id, lineGroupId, userId, dbGroupId });
}

// ─── Internal queue: generation job ─────────────────────────────────────────
// Reuses line_events as the durable queue (see AGENTS.md). The cron sweeper
// retries failed/stalled rows with exponential backoff; the hot path also
// kicks off processing immediately via after().

interface GenerationJobPayload {
  sessionId: string;
  lineGroupId: string;
  userId: string;
  dbGroupId: string;
}

async function enqueueGenerationJob(payload: GenerationJobPayload): Promise<void> {
  const db = createAdminClient();
  // line_event_uid is UNIQUE — namespace per session so retries via /plan
  // re-runs get a fresh row without colliding with old ones.
  const uid = `internal:gen:${payload.sessionId}:${Date.now()}`;

  const { data: row, error } = await db
    .from("line_events")
    .insert({
      line_event_uid: uid,
      event_type: INTERNAL_EVENT_GENERATE_TEMPLATE,
      group_id: payload.dbGroupId,
      payload_json: payload,
      processing_status: "pending",
    })
    .select("id")
    .single();
  if (error || !row) {
    logger.error("enqueueGenerationJob insert failed", { groupId: payload.dbGroupId, error: String(error) });
    // Surface to the user — they're already staring at "正在生成…".
    await pushText(payload.lineGroupId, "排隊生成失敗，請稍後再試。");
    return;
  }

  const rowId = row.id as string;
  // Kick the worker immediately so users don't wait for the next cron tick.
  // The cron still picks it up if this after() crashes.
  after(async () => {
    try {
      await processLineEvent(rowId, INTERNAL_EVENT_GENERATE_TEMPLATE, payload as unknown as Record<string, unknown>, {
        dbGroupId: payload.dbGroupId,
        lineGroupId: payload.lineGroupId,
        userId: payload.userId,
        replyToken: undefined,
        messageText: undefined,
      });
    } catch (err) {
      // processLineEvent already marks the row failed; this catch is just
      // belt-and-suspenders so the postback handler's after() doesn't crash.
      logger.error("generation after() crashed", { rowId, error: String(err) });
    }
  });
}

/**
 * Worker for INTERNAL_EVENT_GENERATE_TEMPLATE rows. Runs the three-tier
 * generator and pushes a preview bubble. Throws on failure so processLineEvent
 * marks the row failed and the cron retries with backoff.
 */
async function runGenerationJob(payload: Record<string, unknown>): Promise<void> {
  const job = payload as unknown as GenerationJobPayload;
  if (!job.sessionId || !job.lineGroupId || !job.userId || !job.dbGroupId) {
    throw new Error("runGenerationJob: malformed payload");
  }

  const session = await getSession(job.sessionId);
  if (!session) throw new Error(`runGenerationJob: session ${job.sessionId} not found`);
  // Idempotency: if a prior attempt already generated for this session, just
  // re-push the preview instead of re-running the generator.
  if (session.status === "generated" && session.templateId) {
    await pushGenerationPreview(session, job, session.templateId);
    return;
  }

  try {
    const out = await generateTemplateFromSurvey({
      answers: session.answers,
      authorLineUserId: job.userId,
    });
    await markGenerated(session.id, out.templateId);
    await pushGenerationPreview(session, job, out.templateId);
  } catch (err) {
    if (err instanceof GenerationFailedError) {
      logger.warn("generation failed", { groupId: job.dbGroupId, reason: err.reason });
      await pushText(job.lineGroupId, generationFailureMessage(err.reason));
      // Don't re-throw for terminal user-input failures — queue retry won't help.
      if (err.reason === "invalid_answers" || err.reason === "irreparable" || err.reason === "no_candidates") {
        return;
      }
    }
    // Throw so processLineEvent marks the row failed → cron retries with backoff.
    throw err;
  }
}

async function pushGenerationPreview(
  session: SurveySession,
  job: GenerationJobPayload,
  templateId: string
): Promise<void> {
  const db = createAdminClient();
  const { data: tmpl } = await db
    .from("trip_templates")
    .select("current_version_id")
    .eq("id", templateId)
    .single();
  const versionId = (tmpl?.current_version_id as string | undefined) ?? null;
  if (!versionId) {
    await pushText(job.lineGroupId, "生成完成但找不到版本，請稍後再試。");
    return;
  }

  const { data: ver } = await db
    .from("trip_template_versions")
    .select("title, summary, duration_days, destination_name")
    .eq("id", versionId)
    .single();

  const preview = buildPreviewBubble(
    session.id,
    (ver?.title as string) ?? "你的旅程草稿",
    (ver?.summary as string) ?? "",
    (ver?.duration_days as number) ?? (session.answers.duration_days ?? 0),
    (ver?.destination_name as string | null) ?? session.answers.destination ?? null
  );
  await pushFlex(job.lineGroupId, "AI 旅程草稿完成", preview, job.dbGroupId);
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
