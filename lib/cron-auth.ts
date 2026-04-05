import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies cron requests are coming from Vercel's cron scheduler.
 *
 * In production: requires Authorization: Bearer <CRON_SECRET>
 * In development: always allowed (no secret required)
 *
 * Returns a 401 NextResponse if unauthorized, or null if the request is valid.
 * Usage: const err = verifyCronRequest(req); if (err) return err;
 */
export function verifyCronRequest(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron-auth] CRON_SECRET is not set in production");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
