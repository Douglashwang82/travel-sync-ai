import { describe, it, expect } from "vitest";

import {
  AUTO_COLLECT_FRESHNESS_MS,
  AUTO_COLLECT_RETRY_COOLDOWN_MS,
  shouldAttemptCollection,
} from "@/services/trending/auto-collect";

const NOW = Date.parse("2026-07-06T12:00:00Z");

describe("shouldAttemptCollection", () => {
  it("collects a never-collected destination", () => {
    expect(shouldAttemptCollection({ lastCollectedAt: null, lastAttemptAtMs: null, nowMs: NOW })).toBe(true);
  });

  it("skips a destination collected within the freshness window", () => {
    const recent = new Date(NOW - AUTO_COLLECT_FRESHNESS_MS + 60_000).toISOString();
    expect(shouldAttemptCollection({ lastCollectedAt: recent, lastAttemptAtMs: null, nowMs: NOW })).toBe(false);
  });

  it("collects again once the freshness window has elapsed", () => {
    const stale = new Date(NOW - AUTO_COLLECT_FRESHNESS_MS - 60_000).toISOString();
    expect(shouldAttemptCollection({ lastCollectedAt: stale, lastAttemptAtMs: null, nowMs: NOW })).toBe(true);
  });

  it("respects the attempt cooldown even when signals are stale", () => {
    const stale = new Date(NOW - AUTO_COLLECT_FRESHNESS_MS - 60_000).toISOString();
    const recentAttempt = NOW - AUTO_COLLECT_RETRY_COOLDOWN_MS + 60_000;
    expect(
      shouldAttemptCollection({ lastCollectedAt: stale, lastAttemptAtMs: recentAttempt, nowMs: NOW })
    ).toBe(false);
  });

  it("retries after the cooldown has elapsed", () => {
    const oldAttempt = NOW - AUTO_COLLECT_RETRY_COOLDOWN_MS - 60_000;
    expect(
      shouldAttemptCollection({ lastCollectedAt: null, lastAttemptAtMs: oldAttempt, nowMs: NOW })
    ).toBe(true);
  });

  it("treats an unparseable timestamp as never-collected", () => {
    expect(
      shouldAttemptCollection({ lastCollectedAt: "not-a-date", lastAttemptAtMs: null, nowMs: NOW })
    ).toBe(true);
  });
});
