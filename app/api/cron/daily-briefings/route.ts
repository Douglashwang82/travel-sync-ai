import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { sendDailyBriefings } from "@/services/daily-briefing";
import { captureError } from "@/lib/monitoring";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/daily-briefings
 *
 * Runs every morning. For each active trip whose travel dates include today,
 * pushes a morning briefing to the LINE group with:
 *   - Confirmed (booked) items for today with times, addresses, and refs
 *   - Items with deadlines due today
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  try {
    const results = await sendDailyBriefings();
    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => !r.sent).length;

    logger.info("daily-briefings done", {
      context: "cron_daily_briefings",
      processed: sent + failed,
    });

    return NextResponse.json({ sent, failed, total: results.length });
  } catch (err) {
    logger.error("daily-briefings cron failed", { context: "cron_daily_briefings" });
    captureError(err, { context: "cron_daily_briefings" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
