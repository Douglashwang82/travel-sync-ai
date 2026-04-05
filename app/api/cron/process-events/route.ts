import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { processLineEvent } from "@/services/event-processor";
import { retryFailedOutbound } from "@/lib/line";
import { verifyCronRequest } from "@/lib/cron-auth";

const MAX_RETRIES = 5;
const BATCH_SIZE = 20;

/**
 * GET /api/cron/process-events
 *
 * Runs every minute (vercel.json). Picks up events stuck in `pending` or
 * `failed` (below retry limit) and reprocesses them.
 * This is the recovery sweeper — it handles crashes, timeouts, and cold-start
 * failures in the original webhook fire-and-forget.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();

  const { data: events, error } = await db
    .from("line_events")
    .select("id, event_type, payload_json, group_id, retry_count")
    .or("processing_status.eq.pending,and(processing_status.eq.failed,retry_count.lt." + MAX_RETRIES + ")")
    .order("received_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/process-events] query error", error);
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

  console.info(`[cron/process-events] processed ${processed}/${events.length}, retried outbound ${retriedOutbound}`);
  return NextResponse.json({ processed, retriedOutbound });
}
