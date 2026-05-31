import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { issueMobileTokens, verifyAppToken } from "@/lib/app-tokens";
import { ensureAppUserForLineId } from "@/lib/app-users";

const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

/**
 * POST /api/app/auth/mobile/refresh
 *
 * Exchanges a valid refresh token for a fresh access + refresh token pair
 * (sliding-window rotation). Used by the mobile client when its short-lived
 * access token expires. Rejects access tokens replayed as refresh tokens, and
 * confirms the subject still maps to a live `app_users` row before re-issuing.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = RefreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const payload = verifyAppToken(parsed.data.refreshToken, "refresh");
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired refresh token.", code: "INVALID_TOKEN" },
      { status: 401 }
    );
  }

  // Confirm the identity still exists before minting new tokens.
  const user = await ensureAppUserForLineId(payload.sub, null);
  if (!user) {
    return NextResponse.json(
      { error: "Account no longer exists.", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true, ...issueMobileTokens(user.line_user_id) });
}
