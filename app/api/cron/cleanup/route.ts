import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { cleanupRateLimitWindows } from "@/lib/rate-limit";
import { captureError } from "@/lib/monitoring";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/cleanup
 *
 * Runs daily at 03:00 UTC. Enforces data retention policy:
 * - raw_messages: delete rows past expires_at (7-day TTL set at insert time)
 * - analytics_events: delete rows older than 1 year
 * - line_events (processed): delete rows older than 30 days to keep the table lean
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  try {
    const db = createAdminClient();
    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const results: Record<string, number> = {};

    const { count: rawCount } = await db
      .from("raw_messages")
      .delete({ count: "exact" })
      .lte("expires_at", now);
    results.raw_messages = rawCount ?? 0;

    const { count: eventCount } = await db
      .from("line_events")
      .delete({ count: "exact" })
      .eq("processing_status", "processed")
      .lte("received_at", thirtyDaysAgo);
    results.line_events = eventCount ?? 0;

    const { count: analyticsCount } = await db
      .from("analytics_events")
      .delete({ count: "exact" })
      .lte("created_at", oneYearAgo);
    results.analytics_events = analyticsCount ?? 0;

    await cleanupRateLimitWindows();

    logger.info("cleanup done", { context: "cron_cleanup" });
    return NextResponse.json({ deleted: results });
  } catch (err) {
    logger.error("cleanup cron failed", { context: "cron_cleanup" });
    captureError(err, { context: "cron_cleanup" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
