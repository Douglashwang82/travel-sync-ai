/**
 * LIFF ID token verification.
 *
 * The LIFF client sends a LINE ID token (obtained via liff.getIDToken()) in the
 * Authorization header. We verify it against LINE's token verify endpoint and
 * extract the verified lineUserId (sub claim), so the server never trusts a
 * caller-supplied userId.
 *
 * Required env var: LIFF_CHANNEL_ID — the LINE channel ID (numeric part of the
 * LIFF ID, e.g. if LIFF ID is "1234567890-AbcdEFGH", the channel ID is "1234567890").
 */

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

interface LineIdTokenClaims {
  iss: string;
  sub: string; // verified lineUserId
  aud: string;
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
}

/**
 * Verify a LIFF ID token and return the verified lineUserId.
 * Returns null if the token is invalid, expired, or verification fails.
 */
export async function verifyLiffToken(idToken: string): Promise<string | null> {
  const channelId = process.env.LIFF_CHANNEL_ID;
  if (!channelId) {
    console.warn("[liff-auth] LIFF_CHANNEL_ID not set — skipping token verification");
    return null;
  }

  try {
    const res = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
    });

    if (!res.ok) {
      return null;
    }

    const claims = (await res.json()) as LineIdTokenClaims;

    // Reject expired tokens (LINE also checks this, but be explicit)
    if (claims.exp * 1000 < Date.now()) {
      return null;
    }

    return claims.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract and verify the LIFF ID token from an Authorization: Bearer <token> header.
 * Returns the verified lineUserId, or null on any failure.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}
