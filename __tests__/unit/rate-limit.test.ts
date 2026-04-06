import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rate limiter tests.
 *
 * Because the store is module-level, we re-import with a fresh module
 * (vitest `isolate: true` handles this per file). We also manipulate
 * Date.now() to simulate time passing without real waits.
 */

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const result = checkRateLimit("user", "user-under-limit");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // 10 - 1
    expect(result.retryAfterMs).toBe(0);
  });

  it("tracks remaining count correctly", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const key = "user-tracking";
    for (let i = 0; i < 5; i++) checkRateLimit("user", key);
    const result = checkRateLimit("user", key);
    expect(result.remaining).toBe(4); // 10 - 6
  });

  it("blocks when user limit (10/min) is exceeded", async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const key = "user-over-limit";
    for (let i = 0; i < 10; i++) checkRateLimit("user", key);
    const result = checkRateLimit("user", key);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("blocks when group limit (60/min) is exceeded", async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const key = "group-over-limit";
    for (let i = 0; i < 60; i++) checkRateLimit("group", key);
    const result = checkRateLimit("group", key);
    expect(result.allowed).toBe(false);
  });

  it("resets after the window expires", async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const key = "user-window-reset";
    for (let i = 0; i < 10; i++) checkRateLimit("user", key);
    expect(checkRateLimit("user", key).allowed).toBe(false);

    // Advance time beyond 60-second window
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit("user", key).allowed).toBe(true);
  });

  it("uses independent limits for group vs user keys", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const userId = "shared-id";
    // Exhaust user limit
    for (let i = 0; i < 10; i++) checkRateLimit("user", userId);
    expect(checkRateLimit("user", userId).allowed).toBe(false);
    // Group with the same key string is independent
    expect(checkRateLimit("group", userId).allowed).toBe(true);
  });

  it("uses independent limits per key", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 10; i++) checkRateLimit("user", "key-a");
    expect(checkRateLimit("user", "key-a").allowed).toBe(false);
    expect(checkRateLimit("user", "key-b").allowed).toBe(true);
  });

  it("retryAfterMs is roughly 60 seconds when all slots are used simultaneously", async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const key = "user-retry";
    for (let i = 0; i < 10; i++) checkRateLimit("user", key);
    const result = checkRateLimit("user", key);
    // All 10 timestamps are at t=0, so retry is ~60s
    expect(result.retryAfterMs).toBeGreaterThan(59_000);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});
