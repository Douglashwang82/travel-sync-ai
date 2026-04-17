import { NextRequest, NextResponse } from "next/server";
import { authenticateLiffRequest } from "@/lib/liff-server";
import { composeAndSendDigest } from "@/services/tracking/digest";

/**
 * POST /api/liff/tracking/digest
 *
 * Compose + send the caller's digest for today using items already in
 * tracking_items (no fetch). Idempotent: if today's digest was already
 * delivered, returns skipped_reason = "already_sent".
 *
 * Useful to preview the LINE message after adding a source + running it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const result = await composeAndSendDigest(auth.lineUserId);
  return NextResponse.json(result);
}
