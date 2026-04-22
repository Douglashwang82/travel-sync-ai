import { NextResponse } from "next/server";
import { isLineLoginConfigured } from "@/lib/app-line-login";

/**
 * GET /api/app/auth/line/config
 *
 * Surfaces whether LINE Login is usable from the browser right now.
 * The sign-in page hits this so it can show the LINE button only when
 * the env vars are set, and fall back to the dev member picker otherwise.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ configured: isLineLoginConfigured() });
}
