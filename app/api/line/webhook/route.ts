import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { verifyLineSignature } from "@/lib/line";
import { createAdminClient } from "@/lib/db";
import { processLineEvent } from "@/services/event-processor";
import { validateEnv } from "@/lib/env";
import { captureError } from "@/lib/monitoring";

// LINE sends this header for signature verification
const SIGNATURE_HEADER = "x-line-signature";

// Zod schema for a single LINE webhook event (partial — enough to route and store)
const LineEventSchema = z.object({
  type: z.string(),
  source: z
    .object({
      type: z.string(),
      groupId: z.string().optional(),
      userId: z.string().optional(),
    })
    .optional(),
  replyToken: z.string().optional(),
  message: z
    .object({
      id: z.string(),
      type: z.string(),
      text: z.string().optional(),
    })
    .optional(),
  // LINE event unique identifier
  webhookEventId: z.string().optional(),
  timestamp: z.number().optional(),
});

const WebhookBodySchema = z.object({
  destination: z.string(),
  events: z.array(z.unknown()),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  validateEnv();
  const rawBody = await req.text();
  const signature = req.headers.get(SIGNATURE_HEADER);

  console.log(`[webhook] Request received from LINE (signature: ${!!signature})`);

  // ── 1. Verify LINE signature ────────────────────────────────────────────────
  if (!verifyLineSignature(rawBody, signature)) {
    console.warn(`[webhook] Invalid signature from LINE. Verify your LINE_CHANNEL_SECRET.`);
    return NextResponse.json(
      { error: "Invalid signature", code: "INVALID_SIGNATURE" },
      { status: 401 }
    );
  }

  // ── 2. Parse body ───────────────────────────────────────────────────────────
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    console.error(`[webhook] Received invalid JSON body.`);
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const bodyResult = WebhookBodySchema.safeParse(parsedBody);
  if (!bodyResult.success) {
    console.warn(`[webhook] Invalid body schema.`, bodyResult.error.flatten());
    return NextResponse.json(
      { error: "Invalid webhook body", code: "INVALID_BODY", details: bodyResult.error.flatten() },
      { status: 400 }
    );
  }

  const { events } = bodyResult.data;
  console.log(`[webhook] Processing ${events.length} events...`);

  // ── 3. Persist each event durably, then trigger async processing ─────────────
  // We must return 200 OK before any slow work — this is a hard LINE requirement.
  const db = createAdminClient();

  const persistPromises = events.map(async (rawEvent: unknown) => {
    const eventResult = LineEventSchema.safeParse(rawEvent);
    if (!eventResult.success) {
      console.warn(`[webhook] Skipping malformed event.`);
      return;
    }

    const event = eventResult.data;
    const lineChatId = event.source?.groupId || event.source?.userId;
    const lineEventUid = event.webhookEventId ?? `${event.timestamp ?? Date.now()}-${Math.random()}`;

    // Upsert the group record if this is a group or 1-to-1 event
    let dbGroupId: string | null = null;
    if (lineChatId) {
      const { data: group } = await db
        .from("line_groups")
        .upsert(
          { line_group_id: lineChatId, last_seen_at: new Date().toISOString() },
          { onConflict: "line_group_id" }
        )
        .select("id")
        .single();
      dbGroupId = group?.id ?? null;
    }

    // Insert event record (idempotent via line_event_uid unique constraint)
    const { data: lineEvent } = await db
      .from("line_events")
      .upsert(
        {
          line_event_uid: lineEventUid,
          group_id: dbGroupId,
          event_type: event.type,
          payload_json: rawEvent as Record<string, unknown>,
          processing_status: "pending",
        },
        { onConflict: "line_event_uid", ignoreDuplicates: true }
      )
      .select("id")
      .single();

    if (!lineEvent) {
      console.log(`[webhook] Duplicate event ID ${lineEventUid} — skipping.`);
      return;
    }

    console.log(`[webhook] Event persisted: ${lineEvent.id} (type: ${event.type})`);

    // Persist raw message for parsing pipeline (TTL 7 days enforced at DB level)
    if (
      event.type === "message" &&
      event.message?.type === "text" &&
      event.message.text &&
      dbGroupId &&
      event.source?.userId
    ) {
      await db.from("raw_messages").insert({
        line_event_id: lineEvent.id,
        group_id: dbGroupId,
        line_user_id: event.source.userId,
        message_text: event.message.text,
      });
    }

    // Schedule work to continue after the response is sent
    after(async () => {
      console.log(`[webhook] Starting background processing for ${lineEvent.id}...`);
      try {
        await processLineEvent(lineEvent.id, event.type, rawEvent as Record<string, unknown>, {
          dbGroupId,
          lineGroupId: lineChatId,
          userId: event.source?.userId,
          replyToken: event.replyToken,
          messageText: event.message?.type === "text" ? event.message.text : undefined,
        });
      } catch (err) {
        console.error(`[webhook] Background processing failed for ${lineEvent.id}`, err);
        captureError(err, { context: "webhook_background", lineEventId: lineEvent.id });
      }
    });
  });

  // Persist all events concurrently (still fast — just DB inserts)
  await Promise.allSettled(persistPromises);

  // ── 4. Return 200 OK immediately ─────────────────────────────────────────────
  return NextResponse.json({ ok: true });
}

