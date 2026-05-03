import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { processLineEvent } from "@/services/event-processor";
import { retryFailedOutbound } from "@/lib/line";
import { verifyCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/monitoring";
import { logger } from "@/lib/logger";

const MAX_RETRIES = 5;
const BATCH_SIZE = 20;
// A row stuck in `processing` for longer than this is assumed to be from a
// crashed worker (after() never returned) and is eligible for re-pickup.
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * GET /api/cron/process-events
 *
 * Runs every minute (vercel.json). Recovery sweeper for the webhook's
 * fire-and-forget after() path. Picks up:
 *   - `pending` events (after() never started or crashed before mark)
 *   - `processing` events older than STALL_THRESHOLD (worker died mid-flight)
 *   - `failed` events under MAX_RETRIES whose backoff window has elapsed
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();

  const now = new Date().toISOString();
  const stallCutoff = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString();

  const { data: events, error } = await db
    .from("line_events")
    .select("id, event_type, payload_json, group_id, retry_count")
    .or(
      [
        "processing_status.eq.pending",
        `and(processing_status.eq.processing,received_at.lt.${stallCutoff})`,
        `and(processing_status.eq.failed,retry_count.lt.${MAX_RETRIES},or(next_retry_at.is.null,next_retry_at.lte.${now}))`,
      ].join(",")
    )
    .order("received_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error("process-events DB query failed", { context: "cron_process_events" });
    captureError(error, { context: "cron_process_events" });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!events?.length) {
    return NextResponse.json({ processed: 0 });
  }

  // Increment retry count before processing to prevent double-processing
  const ids = events.map((e) => e.id);
  await db.rpc("increment_retry_count", { event_ids: ids }).maybeSingle();

  let processed = 0;
  await Promise.allSettled(
    events.map(async (event) => {
      const payload = event.payload_json as Record<string, unknown>;
      const source = (payload.source ?? {}) as Record<string, unknown>;

      await processLineEvent(event.id, event.event_type, payload, {
        dbGroupId: event.group_id,
        lineGroupId: source.groupId as string | undefined,
        userId: source.userId as string | undefined,
        replyToken: payload.replyToken as string | undefined,
        messageText:
          event.event_type === "message"
            ? ((payload.message as Record<string, unknown>)?.text as string | undefined)
            : undefined,
      });
      processed++;
    })
  );

  // Also retry any failed outbound messages
  const retriedOutbound = await retryFailedOutbound();

  logger.info("process-events done", { context: "cron_process_events", processed, retriedOutbound });
  return NextResponse.json({ processed, retriedOutbound });
}
