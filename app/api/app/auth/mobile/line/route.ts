import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isLineLoginConfigured,
  resolveLineLoginConfig,
  verifyLineIdToken,
} from "@/lib/app-line-login";
import { ensureAppUserForLineId } from "@/lib/app-users";
import { issueMobileTokens } from "@/lib/app-tokens";

const ExchangeSchema = z.object({
  idToken: z.string().min(1).max(8192),
  nonce: z.string().min(1).max(256),
});

/**
 * POST /api/app/auth/mobile/line
 *
 * LINE Login for the native mobile app. The client runs the LINE OAuth2 PKCE
 * flow via `expo-auth-session`, generating its own `nonce` and receiving an
 * `id_token` from LINE. It posts both here; we verify the `id_token` against
 * LINE (audience = our channel, matching nonce), upsert the `app_users` row,
 * and return our own access + refresh token pair.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isLineLoginConfigured()) {
    return NextResponse.json(
      { error: "LINE Login is not configured.", code: "LINE_LOGIN_DISABLED" },
      { status: 503 }
    );
  }

  const config = resolveLineLoginConfig(req);
  if (!config) {
    return NextResponse.json(
      { error: "LINE Login is not configured.", code: "LINE_LOGIN_DISABLED" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = ExchangeSchema.safeParse(body);
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

  const claims = await verifyLineIdToken(
    parsed.data.idToken,
    config.channelId,
    parsed.data.nonce
  );
  if (!claims) {
    return NextResponse.json(
      { error: "Could not verify LINE identity.", code: "INVALID_TOKEN" },
      { status: 401 }
    );
  }

  const user = await ensureAppUserForLineId(claims.sub, claims.name ?? null);
  if (!user) {
    return NextResponse.json(
      { error: "Could not establish a session.", code: "SESSION_ERROR" },
      { status: 500 }
    );
  }

  const tokens = issueMobileTokens(user.line_user_id);
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name ?? claims.name ?? null,
      avatarUrl: user.avatar_url ?? claims.picture ?? null,
    },
    ...tokens,
  });
}
