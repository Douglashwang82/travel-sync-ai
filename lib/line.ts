import * as line from "@line/bot-sdk";
import crypto from "crypto";
import { createAdminClient } from "./db";

const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim() || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || "";

export const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken,
});

/**
 * Verify the X-Line-Signature header against the raw request body.
 * Must be called before any other processing in the webhook handler.
 */
export function verifyLineSignature(
  body: string,
  signature: string | null
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(body)
    .digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// ─── Outbound helpers with tracking ──────────────────────────────────────────
// All push/reply helpers log to outbound_messages for retry and audit.
// lineGroupId is the LINE group ID string (not the DB UUID).

/**
 * Reply to a LINE event using the reply token.
 */
export async function replyText(
  replyToken: string,
  text: string
): Promise<void> {
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

/**
 * Push a text message to a group or user, with outbound tracking.
 */
export async function pushText(
  to: string,
  text: string,
  groupId?: string
): Promise<void> {
  const record = await trackOutbound("text", { to, text }, groupId);
  try {
    await lineClient.pushMessage({ to, messages: [{ type: "text", text }] });
    await markOutboundSent(record?.id);
  } catch (err) {
    await markOutboundFailed(record?.id, err);
    throw err;
  }
}

/**
 * Push a Flex Message to a group or user, with outbound tracking.
 */
export async function pushFlex(
  to: string,
  altText: string,
  contents: line.messagingApi.FlexContainer,
  groupId?: string
): Promise<void> {
  const record = await trackOutbound("flex", { to, altText, contents }, groupId);
  try {
    await lineClient.pushMessage({
      to,
      messages: [{ type: "flex", altText, contents }],
    });
    await markOutboundSent(record?.id);
  } catch (err) {
    await markOutboundFailed(record?.id, err);
    throw err;
  }
}

/**
 * Reply with a Flex Message.
 */
export async function replyFlex(
  replyToken: string,
  altText: string,
  contents: line.messagingApi.FlexContainer
): Promise<void> {
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: "flex", altText, contents }],
  });
}

// ─── Outbound tracking helpers ────────────────────────────────────────────────

async function trackOutbound(
  type: string,
  payload: Record<string, unknown>,
  groupId?: string
): Promise<{ id: string } | null> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("outbound_messages")
      .insert({ message_type: type, payload_json: payload, group_id: groupId ?? null })
      .select("id")
      .single();
    return data;
  } catch {
    return null;
  }
}

async function markOutboundSent(id: string | undefined): Promise<void> {
  if (!id) return;
  const db = createAdminClient();
  await db
    .from("outbound_messages")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
}

async function markOutboundFailed(id: string | undefined, err: unknown): Promise<void> {
  if (!id) return;
  const db = createAdminClient();
  const reason = err instanceof Error ? err.message : String(err);
  await db
    .from("outbound_messages")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", id);
}

// ─── Retry helper (called by process-events cron) ─────────────────────────────

const MAX_OUTBOUND_RETRIES = 3;

/**
 * Retry failed outbound messages. Returns the number of messages retried.
 */
export async function retryFailedOutbound(): Promise<number> {
  const db = createAdminClient();

  const { data: failed } = await db
    .from("outbound_messages")
    .select("id, message_type, payload_json, retry_count")
    .eq("status", "failed")
    .lt("retry_count", MAX_OUTBOUND_RETRIES)
    .order("created_at", { ascending: true })
    .limit(20);

  if (!failed?.length) return 0;

  let retried = 0;
  for (const msg of failed) {
    const payload = msg.payload_json as Record<string, unknown>;
    try {
      if (msg.message_type === "text") {
        await lineClient.pushMessage({
          to: payload.to as string,
          messages: [{ type: "text", text: payload.text as string }],
        });
      } else if (msg.message_type === "flex") {
        await lineClient.pushMessage({
          to: payload.to as string,
          messages: [{
            type: "flex",
            altText: payload.altText as string,
            contents: payload.contents as line.messagingApi.FlexContainer,
          }],
        });
      }
      await db
        .from("outbound_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", msg.id);
      retried++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .from("outbound_messages")
        .update({
          status: "failed",
          failure_reason: reason,
          retry_count: msg.retry_count + 1,
        })
        .eq("id", msg.id);
    }
  }
  return retried;
}
