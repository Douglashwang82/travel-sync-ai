import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import {
  LINE_OAUTH_STATE_COOKIE,
  decodeOAuthCookie,
  exchangeLineAuthorizationCode,
  originFromRequest,
  resolveLineLoginConfig,
  sanitizeNextPath,
  verifyLineIdToken,
} from "@/lib/app-line-login";
import { setAppSessionCookie } from "@/lib/app-server";
import { ensureAppUserForLineId } from "@/lib/app-users";

/**
 * GET /api/app/auth/line/callback?code=...&state=...
 *
 * Completes the LINE Login OAuth2 flow:
 *   1. Verifies the returned state against the cookie issued by /start
 *   2. Exchanges the authorization code for an id_token
 *   3. Verifies the id_token (audience + nonce + expiry) and extracts the LINE user ID
 *   4. Checks the user is a member of at least one active group (otherwise they
 *      have no data to manage and we bounce them with a helpful error)
 *   5. Stamps the `ts_app_user` session cookie and redirects to the original `next`
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const config = resolveLineLoginConfig(req);
  if (!config) {
    return redirectToSignInWithError(req, "not_configured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const lineError = url.searchParams.get("error");

  if (lineError) {
    // User hit "Cancel" on LINE's consent screen, or the authorize step failed.
    return redirectToSignInWithError(req, "cancelled");
  }

  if (!code || !state) {
    return redirectToSignInWithError(req, "invalid_callback");
  }

  const cookie = req.cookies.get(LINE_OAUTH_STATE_COOKIE)?.value;
  if (!cookie) {
    return redirectToSignInWithError(req, "missing_state");
  }

  const payload = decodeOAuthCookie(cookie);
  if (!payload) {
    return redirectToSignInWithError(req, "invalid_state");
  }

  if (payload.state !== state) {
    return redirectToSignInWithError(req, "state_mismatch");
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeLineAuthorizationCode(code, config);
  } catch (err) {
    console.error("[line-login] token exchange failed", err);
    return redirectToSignInWithError(req, "token_exchange_failed");
  }

  if (!tokenResponse.id_token) {
    return redirectToSignInWithError(req, "missing_id_token");
  }

  const claims = await verifyLineIdToken(
    tokenResponse.id_token,
    config.channelId,
    payload.nonce
  );
  if (!claims) {
    return redirectToSignInWithError(req, "invalid_id_token");
  }

  const lineUserId = claims.sub;

  // Materialize the `app_users` row for this LINE identity so the session
  // cookie (which carries `line_user_id`) always resolves to a known user.
  // We no longer gate on group membership: a user that signed in via LINE
  // Login but has never been in a group can still be added directly to a
  // trip via `trip_members`.
  const appUser = await ensureAppUserForLineId(lineUserId, claims.name ?? null);
  if (!appUser) {
    return redirectToSignInWithError(req, "token_exchange_failed");
  }

  // Opportunistically refresh the cached display name from LINE's profile claim.
  const db = createAdminClient();
  if (claims.name) {
    await db
      .from("group_members")
      .update({ display_name: claims.name })
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .is("display_name", null);
    if (!appUser.display_name) {
      await db
        .from("app_users")
        .update({ display_name: claims.name })
        .eq("id", appUser.id);
    }
  }

  const next = sanitizeNextPath(payload.next);
  const res = NextResponse.redirect(`${originFromRequest(req)}${next}`, { status: 302 });
  setAppSessionCookie(res, lineUserId);
  // Clear the short-lived oauth cookie — it's single-use.
  res.cookies.set({
    name: LINE_OAUTH_STATE_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return res;
}

function redirectToSignInWithError(req: NextRequest, code: string): NextResponse {
  const target = new URL("/app/sign-in", originFromRequest(req));
  target.searchParams.set("error", code);
  const res = NextResponse.redirect(target.toString(), { status: 302 });
  res.cookies.set({
    name: LINE_OAUTH_STATE_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return res;
}
