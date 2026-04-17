import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * GET /api/cron/tracking-digest
 *
 * Daily run (vercel.json: "0 6 * * *" — 06:00 UTC ≈ 14:00 Asia/Taipei).
 * Scaffold only. Full pipeline:
 *   1. SELECT active tracking_lists where last_run_at is null OR
 *      now() - last_run_at >= frequency_hours.
 *   2. For each list, runTrackingList() (services/tracking/runner.ts) —
 *      uses Promise.allSettled with a concurrency cap of ~5 to avoid
 *      exceeding Vercel function execution time and third-party rate limits.
 *   3. For each unique line_user_id, composeAndSendDigest()
 *      (services/tracking/digest.ts).
 *   4. Return counts for observability.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  return NextResponse.json(
    {
      status: "scaffold",
      job: "tracking-digest",
      message: "TravelSync AI tracking-digest cron scaffold is in place.",
    },
    { status: 501 }
  );
}
