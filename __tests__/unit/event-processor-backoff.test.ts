import { describe, it, expect } from "vitest";
import { computeNextRetryAt } from "@/services/event-processor";

describe("computeNextRetryAt", () => {
  const now = new Date("2026-05-03T00:00:00.000Z").getTime();

  it("schedules first retry 2 seconds out (2^1)", () => {
    expect(computeNextRetryAt(0, now)).toBe("2026-05-03T00:00:02.000Z");
  });

  it("doubles each attempt", () => {
    expect(computeNextRetryAt(1, now)).toBe("2026-05-03T00:00:04.000Z"); // 2^2
    expect(computeNextRetryAt(2, now)).toBe("2026-05-03T00:00:08.000Z"); // 2^3
    expect(computeNextRetryAt(3, now)).toBe("2026-05-03T00:00:16.000Z"); // 2^4
  });

  it("caps at 1 hour to bound poison-message delay", () => {
    // 2^12 = 4096s > 3600s cap. Anything ≥ retryCount=11 should hit the cap.
    const capped = new Date(now + 3600 * 1000).toISOString();
    expect(computeNextRetryAt(11, now)).toBe(capped);
    expect(computeNextRetryAt(20, now)).toBe(capped);
    expect(computeNextRetryAt(100, now)).toBe(capped);
  });

  it("treats negative retryCount as if it were 0 (defensive)", () => {
    // 2^0 = 1s, not 2s — documents the behavior so callers don't pass <0.
    expect(computeNextRetryAt(-1, now)).toBe("2026-05-03T00:00:01.000Z");
  });
});
