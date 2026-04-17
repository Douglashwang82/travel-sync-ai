import { NextRequest, NextResponse } from "next/server";

/**
 * /api/liff/tracking
 *
 * Scaffold for the user-facing LIFF endpoints:
 *   GET    → list current user's tracking_lists rows (+ last digest preview)
 *   POST   → create a new tracking_lists row (validates url via zod)
 *   PATCH  → toggle is_active / update category / keywords
 *   DELETE → soft-remove (is_active = false, 30d hard-delete via cleanup cron)
 *
 * Auth: LIFF ID token via verifyLiffToken() from lib/liff-server.ts.
 * See docs/tracking-list.md for the request/response shapes.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { status: "scaffold", endpoint: "liff/tracking" },
    { status: 501 }
  );
}
