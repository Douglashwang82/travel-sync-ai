/**
 * In-memory sliding-window rate limiter.
 *
 * Limits:
 *   - Group:  60 commands per minute
 *   - User:   10 commands per minute
 *
 * Uses a simple timestamp-queue per key. On Vercel serverless this resets per
 * cold start, which is acceptable for MVP — the DB-backed version can replace
 * this if needed at scale.
 */

interface Window {
  timestamps: number[];
}

const store = new Map<string, Window>();

const LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  group: { maxRequests: 60, windowMs: 60_000 },
  user:  { maxRequests: 10, windowMs: 60_000 },
};

export type RateLimitType = keyof typeof LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Check and record a request attempt.
 * @param type  "group" or "user"
 * @param key   The group ID or user ID
 */
export function checkRateLimit(type: RateLimitType, key: string): RateLimitResult {
  const { maxRequests, windowMs } = LIMITS[type];
  const storeKey = `${type}:${key}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  let window = store.get(storeKey);
  if (!window) {
    window = { timestamps: [] };
    store.set(storeKey, window);
  }

  // Evict timestamps outside the window
  window.timestamps = window.timestamps.filter((t) => t > cutoff);

  if (window.timestamps.length >= maxRequests) {
    const oldestInWindow = window.timestamps[0];
    const retryAfterMs = windowMs - (now - oldestInWindow);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  window.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - window.timestamps.length,
    retryAfterMs: 0,
  };
}

// Periodic cleanup to prevent unbounded memory growth
// Removes windows that have had no activity for > 2 minutes
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 2 * 60_000;
  setInterval(() => {
    const cutoff = Date.now() - CLEANUP_INTERVAL;
    for (const [key, window] of store) {
      const lastSeen = window.timestamps.at(-1) ?? 0;
      if (lastSeen < cutoff) store.delete(key);
    }
  }, CLEANUP_INTERVAL).unref?.();
}
