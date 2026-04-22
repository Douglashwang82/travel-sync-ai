/**
 * Shared helpers for the LINE Login OAuth2 flow that signs users into the
 * browser-based `/app` workspace.
 *
 * Config comes from three env vars:
 *   LINE_LOGIN_CHANNEL_ID      — the LINE Login channel's "Channel ID"
 *   LINE_LOGIN_CHANNEL_SECRET  — its "Channel secret"
 *   LINE_LOGIN_REDIRECT_URI    — optional override; otherwise derived from the request origin
 *
 * Production hosts MUST whitelist the resulting redirect URI in the LINE
 * Developers console (Callback URLs).
 */

import { NextRequest } from "next/server";

export interface LineLoginConfig {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
}

export function isLineLoginConfigured(): boolean {
  return Boolean(
    process.env.LINE_LOGIN_CHANNEL_ID?.trim() &&
      process.env.LINE_LOGIN_CHANNEL_SECRET?.trim()
  );
}

/**
 * Resolve the full LINE Login config for this request. Prefers an explicit
 * override (LINE_LOGIN_REDIRECT_URI) so that previews/ngrok match what's
 * whitelisted in LINE's console; otherwise derives from the request origin.
 */
export function resolveLineLoginConfig(req: NextRequest): LineLoginConfig | null {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) return null;

  const override = process.env.LINE_LOGIN_REDIRECT_URI?.trim();
  const redirectUri = override || `${originFromRequest(req)}/api/app/auth/line/callback`;

  return { channelId, channelSecret, redirectUri };
}

/**
 * Derive the public origin of a request, respecting reverse-proxy forwarded
 * headers if present (so preview deployments work behind Vercel/Cloudflare).
 */
export function originFromRequest(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto ?? (forwardedHost.includes("localhost") ? "http" : "https");
    return `${proto}://${forwardedHost}`;
  }
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Only accept in-app relative paths as the post-login redirect target.
 * Rejects absolute URLs, protocol-relative `//evil.example.com`, and paths
 * that escape the app via `/..`.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/app";
  if (!raw.startsWith("/")) return "/app";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/app";
  // Block attempts to break out via encoded slashes.
  if (raw.includes("\n") || raw.includes("\r")) return "/app";
  return raw;
}

export const LINE_OAUTH_STATE_COOKIE = "ts_app_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;

export interface OAuthCookiePayload {
  state: string;
  nonce: string;
  next: string;
}

/**
 * Pack the state/nonce/next tuple into a single short-lived HttpOnly cookie.
 * The cookie is not encrypted — the fields it contains are only meaningful
 * when compared against the matching callback, and a stolen cookie alone
 * can't complete a login without the concurrent LINE redirect.
 */
export function encodeOAuthCookie(payload: OAuthCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOAuthCookie(raw: string): OAuthCookiePayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<OAuthCookiePayload>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.next !== "string"
    ) {
      return null;
    }
    return parsed as OAuthCookiePayload;
  } catch {
    return null;
  }
}

export function oAuthCookieMaxAge(): number {
  return OAUTH_TTL_SECONDS;
}

// ─── LINE endpoints ───────────────────────────────────────────────────────────

export const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
export const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
export const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

export interface LineTokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token: string;
  scope: string;
  token_type: "Bearer";
}

export interface LineVerifiedIdToken {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
  name?: string;
  picture?: string;
}

/**
 * Exchange an authorization code for tokens via LINE's token endpoint.
 * Caller is responsible for verifying state before calling this.
 */
export async function exchangeLineAuthorizationCode(
  code: string,
  config: LineLoginConfig
): Promise<LineTokenResponse> {
  const res = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE token exchange failed (${res.status}): ${body}`);
  }

  return (await res.json()) as LineTokenResponse;
}

/**
 * Verify an id_token against LINE's verify endpoint, ensuring the audience
 * matches our channel and the nonce matches the one we issued.
 */
export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
  expectedNonce: string
): Promise<LineVerifiedIdToken | null> {
  const res = await fetch(LINE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: channelId,
      nonce: expectedNonce,
    }).toString(),
  });

  if (!res.ok) return null;

  const claims = (await res.json()) as LineVerifiedIdToken;
  if (!claims.sub) return null;
  if (claims.exp * 1000 < Date.now()) return null;
  if (claims.nonce && claims.nonce !== expectedNonce) return null;
  return claims;
}
