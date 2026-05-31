import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  issueMobileTokens,
  verifyAppToken,
  lineUserIdFromAuthHeader,
} from "@/lib/app-tokens";

const SECRET = "test-secret-at-least-16-chars-long";

describe("app-tokens", () => {
  beforeEach(() => {
    process.env.APP_JWT_SECRET = SECRET;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.APP_JWT_SECRET;
  });

  it("issues a verifiable access + refresh pair carrying the line_user_id", () => {
    const { accessToken, refreshToken, expiresIn, tokenType } =
      issueMobileTokens("Uabc123");

    expect(tokenType).toBe("Bearer");
    expect(expiresIn).toBeGreaterThan(0);

    const access = verifyAppToken(accessToken, "access");
    const refresh = verifyAppToken(refreshToken, "refresh");
    expect(access?.sub).toBe("Uabc123");
    expect(access?.type).toBe("access");
    expect(refresh?.sub).toBe("Uabc123");
    expect(refresh?.type).toBe("refresh");
  });

  it("rejects a refresh token replayed as an access token (and vice versa)", () => {
    const { accessToken, refreshToken } = issueMobileTokens("Uabc123");
    expect(verifyAppToken(refreshToken, "access")).toBeNull();
    expect(verifyAppToken(accessToken, "refresh")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { accessToken } = issueMobileTokens("Uabc123");
    const [header, , signature] = accessToken.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: "Uattacker", type: "access", iat: 0, exp: 9e9 })
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      verifyAppToken(`${header}.${forgedBody}.${signature}`, "access")
    ).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { accessToken } = issueMobileTokens("Uabc123");
    process.env.APP_JWT_SECRET = "a-completely-different-secret-value";
    expect(verifyAppToken(accessToken, "access")).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { accessToken } = issueMobileTokens("Uabc123");
    // Access TTL is 1h; jump 2h forward.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    expect(verifyAppToken(accessToken, "access")).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyAppToken("not.a.jwt", "access")).toBeNull();
    expect(verifyAppToken("only-one-part", "access")).toBeNull();
    expect(verifyAppToken("", "access")).toBeNull();
  });

  it("extracts the line_user_id from a Bearer header", () => {
    const { accessToken } = issueMobileTokens("Uxyz789");
    expect(lineUserIdFromAuthHeader(`Bearer ${accessToken}`)).toBe("Uxyz789");
    expect(lineUserIdFromAuthHeader(`bearer ${accessToken}`)).toBe("Uxyz789");
  });

  it("returns null for missing or malformed Authorization headers", () => {
    expect(lineUserIdFromAuthHeader(null)).toBeNull();
    expect(lineUserIdFromAuthHeader("")).toBeNull();
    expect(lineUserIdFromAuthHeader("Bearer")).toBeNull();
    expect(lineUserIdFromAuthHeader("Basic abc")).toBeNull();
  });

  it("throws when no secret is configured", () => {
    delete process.env.APP_JWT_SECRET;
    expect(() => issueMobileTokens("Uabc123")).toThrow(/APP_JWT_SECRET/);
  });
});
