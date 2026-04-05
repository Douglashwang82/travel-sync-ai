import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";
import { routeCommand } from "@/bot/router";
import { parseMessage } from "@/services/parsing";
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
  console.log(`[processor] Starting work on event ${lineEventId} (type: ${eventType})`);

  // Mark as processing
  await db
    .from("line_events")
    .update({ processing_status: "processing" })
    .eq("id", lineEventId);
  console.log(`[processor] Event ${lineEventId} is now marked as 'processing'`);

  try {
    switch (eventType) {
      case "join":
      case "follow":
        console.log(`[processor] Handling JOIN/FOLLOW event`);
        await handleJoin(ctx);
        break;

      case "leave":
        console.log(`[processor] Handling LEAVE event`);
        await handleLeave(ctx);
        break;

      case "message":
        console.log(`[processor] Handling MESSAGE event (text: "${ctx.messageText?.substring(0, 20)}...")`);
        await handleMessage(ctx, lineEventId);
        break;

      case "postback":
        console.log(`[processor] Handling POSTBACK event`);
        await handlePostback(payload, ctx);
        break;

      default:
        console.log(`[processor] Ignoring unknown event type: ${eventType}`);
        break;
    }

    console.log(`[processor] Finished event ${lineEventId} successfully.`);
    await db
      .from("line_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", lineEventId);
  } catch (err) {
    console.error("[processor] CRITICAL ERROR", { lineEventId, eventType, err });
    const failureReason = err instanceof Error ? err.message : String(err);

    await db
      .from("line_events")
      .update({
        processing_status: "failed",
        failure_reason: failureReason,
      })
      .eq("id", lineEventId);
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleJoin(ctx: EventContext): Promise<void> {
  if (!ctx.lineGroupId) {
    console.warn(`[processor] handleJoin failed: No lineGroupId`);
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
  console.log(`[processor] handleMessage called (text: "${messageText?.substring(0, 20)}...")`);
  if (!messageText || !lineGroupId) {
    console.warn(`[processor] handleMessage early return: missing messageText or lineGroupId`);
    return;
  }

  // Route slash commands immediately
  if (messageText.startsWith("/")) {
    await routeCommand(messageText, {
      lineGroupId,
      dbGroupId,
      userId,
      replyToken,
    });
    return;
  }

  // Non-command messages: run through the LLM parsing pipeline
  if (dbGroupId) {
    await parseMessage({
      messageText,
      groupId: dbGroupId,
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
      // Close the vote and announce
      await closeVote(itemId, result.majority.winningOptionId, ctx.dbGroupId);
      await announceWinner(itemId, result.majority.winningOptionId, ctx.dbGroupId, ctx.lineGroupId);
    } else {
      // Refresh the carousel with updated vote counts
      await refreshVoteCarousel(itemId, ctx.lineGroupId);
    }
  }
}
