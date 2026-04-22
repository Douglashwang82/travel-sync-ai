import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  LINE_AUTHORIZE_URL,
  LINE_OAUTH_STATE_COOKIE,
  encodeOAuthCookie,
  oAuthCookieMaxAge,
  resolveLineLoginConfig,
  sanitizeNextPath,
} from "@/lib/app-line-login";

/**
 * GET /api/app/auth/line/start?next=/app/trips/abc
 *
 * Generates a state+nonce pair, stores them in a short-lived HttpOnly cookie,
 * and 302s the browser to LINE's authorize endpoint. The callback route
 * verifies the state and nonce before accepting a session.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const config = resolveLineLoginConfig(req);
  if (!config) {
    return NextResponse.json(
      { error: "LINE Login is not configured on this deployment", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const next = sanitizeNextPath(url.searchParams.get("next"));

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");

  const authorizeUrl = new URL(LINE_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.channelId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("scope", "profile openid");
  authorizeUrl.searchParams.set("bot_prompt", "normal");

  const res = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  res.cookies.set({
    name: LINE_OAUTH_STATE_COOKIE,
    value: encodeOAuthCookie({ state, nonce, next }),
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: oAuthCookieMaxAge(),
  });
  return res;
}
