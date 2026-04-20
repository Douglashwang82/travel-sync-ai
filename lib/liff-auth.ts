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

const E2E_MOCK_TOKEN = "e2e-liff-token";
const E2E_MOCK_USER_ID = "U_E2E_USER";

/**
 * Verify a LIFF ID token and return the verified lineUserId.
 * Returns null if the token is invalid, expired, or verification fails.
 */
export async function verifyLiffToken(idToken: string): Promise<string | null> {
  // Allow E2E mock token only when explicitly enabled server-side — never in production
  if (
    process.env.NEXT_PUBLIC_E2E_LIFF_MOCK === "1" &&
    idToken === E2E_MOCK_TOKEN
  ) {
    return E2E_MOCK_USER_ID;
  }

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
