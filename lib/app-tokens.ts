import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless bearer tokens for the native mobile app.
 *
 * The web `/app` experience authenticates with an HttpOnly `ts_app_user`
 * cookie (see `lib/app-server.ts`). Native apps cannot share the browser
 * cookie jar, so mobile clients carry a signed JWT in the
 * `Authorization: Bearer <token>` header instead.
 *
 * We sign with HMAC-SHA256 using Node's built-in `crypto` — the same
 * dependency-free approach `lib/passwords.ts` takes — so there is no native
 * binary or extra package to ship on Vercel. The token `sub` is the user's
 * `line_user_id`, which is exactly what the session cookie holds, so both
 * auth paths resolve to the same identity downstream.
 */

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

export type AppTokenType = "access" | "refresh";

export interface AppTokenPayload {
  /** Subject — the user's `line_user_id`. */
  sub: string;
  /** Distinguishes access tokens from refresh tokens. */
  type: AppTokenType;
  /** Issued-at (seconds since epoch). */
  iat: number;
  /** Expiry (seconds since epoch). */
  exp: number;
}

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: "Bearer";
}

function getSecret(): string {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "APP_JWT_SECRET is not set (or too short). Set a >=16 char secret to issue mobile tokens."
    );
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(data: string): string {
  return base64url(createHmac("sha256", getSecret()).update(data).digest());
}

const HEADER = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function signToken(sub: string, type: AppTokenType, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AppTokenPayload = { sub, type, iat: now, exp: now + ttlSeconds };
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${HEADER}.${body}`;
  return `${signingInput}.${sign(signingInput)}`;
}

/**
 * Issue a fresh access + refresh token pair for the given `line_user_id`.
 */
export function issueMobileTokens(lineUserId: string): MobileTokenPair {
  return {
    accessToken: signToken(lineUserId, "access", ACCESS_TTL_SECONDS),
    refreshToken: signToken(lineUserId, "refresh", REFRESH_TTL_SECONDS),
    expiresIn: ACCESS_TTL_SECONDS,
    tokenType: "Bearer",
  };
}

/**
 * Verify a token's signature and expiry. Returns the decoded payload, or
 * `null` if the token is malformed, tampered with, or expired. `expectedType`
 * guards against replaying a refresh token as an access token and vice versa.
 */
export function verifyAppToken(
  token: string,
  expectedType: AppTokenType
): AppTokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expected = sign(`${header}.${body}`);
  let provided: Buffer;
  let expectedBuf: Buffer;
  try {
    provided = base64urlDecode(signature);
    expectedBuf = base64urlDecode(expected);
  } catch {
    return null;
  }
  if (provided.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(provided, expectedBuf)) return null;

  let payload: AppTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8")) as AppTokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (payload.type !== expectedType) return null;
  if (typeof payload.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;

  return payload;
}

/**
 * Extract the `line_user_id` from an `Authorization: Bearer <jwt>` header
 * value, verifying it as an access token. Returns `null` when the header is
 * absent, malformed, or carries an invalid/expired token.
 */
export function lineUserIdFromAuthHeader(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return null;
  const payload = verifyAppToken(match[1], "access");
  return payload?.sub ?? null;
}
