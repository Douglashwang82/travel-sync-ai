import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { routeCommand } from "@/bot/router";
import { parseMessage } from "@/services/parsing";
import { handleDirectMessage } from "@/services/private-chat";
import { castVote, closeVote } from "@/services/vote";
import { refreshVoteCarousel, announceWinner } from "@/services/decisions";

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
    "👋 Hi! I'm TravelSync AI — your group trip planning co-pilot.\n\n" +
    "Let's get started!\nType /start [destination] [dates] to kick off a trip.\n" +
    "Example: /start Osaka 7/15-7/20\n\n" +
    "Type /help to see all commands.\n\n" +
    "⚠️ Privacy notice: I'll parse travel-related messages to help plan your trip. " +
    "Type /optout at any time to stop.";

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
      await pushText(ctx.lineGroupId, result.error ?? "Could not record your vote.");
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
