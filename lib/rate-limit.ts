/**
 * Database-backed sliding-window rate limiter.
 *
 * Limits:
 *   - Group:  60 commands per minute
 *   - User:   10 commands per minute
 *
 * Uses a Supabase table (rate_limit_windows) so counts persist across Vercel
 * cold starts and serverless instances. Falls back to an in-memory store if
 * the DB call fails, so a Supabase outage won't break the webhook.
 *
 * See migration: 20260412000000_rate_limit_windows.sql
 */

import { createAdminClient } from "./db";

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

// ─── In-memory fallback (used only when DB is unreachable) ────────────────────

interface MemWindow { timestamps: number[] }
const memStore = new Map<string, MemWindow>();

function checkMemory(type: RateLimitType, key: string): RateLimitResult {
  const { maxRequests, windowMs } = LIMITS[type];
  const storeKey = `${type}:${key}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  let w = memStore.get(storeKey);
  if (!w) { w = { timestamps: [] }; memStore.set(storeKey, w); }
  w.timestamps = w.timestamps.filter((t) => t > cutoff);

  if (w.timestamps.length >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - w.timestamps[0]) };
  }
  w.timestamps.push(now);
  return { allowed: true, remaining: maxRequests - w.timestamps.length, retryAfterMs: 0 };
}

// ─── DB-backed implementation ─────────────────────────────────────────────────

/**
 * Check and record a request attempt.
 * @param type  "group" or "user"
 * @param key   The group ID or user ID
 */
export async function checkRateLimit(type: RateLimitType, key: string): Promise<RateLimitResult> {
  const { maxRequests, windowMs } = LIMITS[type];
  const storeKey = `${type}:${key}`;

  // Truncate current time to the start of the current window
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString();

  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("rate_limit_increment", {
      p_key: storeKey,
      p_window_start: windowStart,
      p_max_requests: maxRequests,
    });

    if (error) throw error;

    const count = data as number;

    if (count > maxRequests) {
      // Window expires at windowStart + windowMs
      const windowExpiry = Math.floor(now / windowMs) * windowMs + windowMs;
      const retryAfterMs = windowExpiry - now;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: maxRequests - count, retryAfterMs: 0 };
  } catch (err) {
    // DB unavailable — degrade gracefully to in-memory limiter
    console.warn(`[rate-limit] DB call failed, using in-memory fallback: ${err instanceof Error ? err.message : String(err)}`);
    return checkMemory(type, key);
  }
}

// ─── Cleanup (called by cleanup cron via Supabase RPC) ────────────────────────

/**
 * Remove expired rate limit windows from the DB.
 * Call from /api/cron/cleanup to prevent unbounded table growth.
 */
export async function cleanupRateLimitWindows(): Promise<void> {
  try {
    const db = createAdminClient();
    await db.rpc("rate_limit_cleanup");
  } catch (err) {
    console.warn(`[rate-limit] cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Periodic in-memory cleanup (fallback store only) ─────────────────────────
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 2 * 60_000;
  setInterval(() => {
    const cutoff = Date.now() - CLEANUP_INTERVAL;
    for (const [key, w] of memStore) {
      if ((w.timestamps.at(-1) ?? 0) < cutoff) memStore.delete(key);
    }
  }, CLEANUP_INTERVAL).unref?.();
}
