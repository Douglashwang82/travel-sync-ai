// ─────────────────────────────────────────────────────────────────────────────
// Self-healing trending collection — no human in the loop.
//
// Two automatic paths keep poi_trending_signals warm:
//   • the daily trending-pois cron (proactive, seeded with home catalog
//     cities + destinations with trip/survey demand), and
//   • maybeCollectTrendingPois() here (reactive): public surfaces call it
//     fire-and-forget via next/server after() when they serve a destination,
//     so a cold or stale city collects itself the first time a visitor looks
//     at it — even between cron runs, and in environments with no cron at all.
//
// Guard rails (this runs behind unauthenticated routes, so cost is bounded):
//   1. callers only pass catalog-validated destinations — the universe is
//      finite, never client-controlled free text;
//   2. a DB freshness check skips destinations collected within 20h;
//   3. a per-instance in-flight set + attempt cooldown stop request stampedes
//      and stop a zero-result destination from re-collecting on every hit.
//      (In-memory state resets on cold start; worst case is one duplicate
//      collection per new serverless instance, and all writes are idempotent
//      upserts.)
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { collectTrendingPois } from "./collector";

/** Signals younger than this are fresh — same window the cron uses. */
export const AUTO_COLLECT_FRESHNESS_MS = 20 * 60 * 60 * 1000;

/** Per-instance cooldown between collection attempts for one destination. */
export const AUTO_COLLECT_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

const inFlight = new Set<string>();
const lastAttemptAtMs = new Map<string, number>();

export type AutoCollectOutcome =
  | "collected"
  | "fresh"
  | "in_flight"
  | "cooldown"
  | "failed";

/**
 * Pure freshness/cooldown decision — exported for unit tests.
 * `lastCollectedAt` is the newest signal timestamp for the destination (null
 * when the destination has never been collected).
 */
export function shouldAttemptCollection(input: {
  lastCollectedAt: string | null;
  lastAttemptAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.lastAttemptAtMs != null && input.nowMs - input.lastAttemptAtMs < AUTO_COLLECT_RETRY_COOLDOWN_MS) {
    return false;
  }
  if (input.lastCollectedAt == null) return true;
  const collected = new Date(input.lastCollectedAt).getTime();
  if (!Number.isFinite(collected)) return true;
  return input.nowMs - collected >= AUTO_COLLECT_FRESHNESS_MS;
}

/**
 * Collect trending POIs for `destination` iff its signals are cold or stale.
 *
 * `matchTerm` is the substring used for the freshness lookup (usually the
 * bare city name) so signals stored under any destination variant — "Tokyo",
 * "Tokyo, Japan" — count as coverage. Never throws; intended to be called
 * fire-and-forget from after().
 */
export async function maybeCollectTrendingPois(
  destination: string,
  matchTerm?: string
): Promise<AutoCollectOutcome> {
  const key = destination.trim().toLowerCase();
  const now = Date.now();

  if (inFlight.has(key)) return "in_flight";
  if (!shouldAttemptCollection({ lastCollectedAt: null, lastAttemptAtMs: lastAttemptAtMs.get(key) ?? null, nowMs: now })) {
    return "cooldown";
  }

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("poi_trending_signals")
      .select("collected_at")
      .ilike("destination_name", `%${(matchTerm ?? destination).trim()}%`)
      .order("collected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`freshness lookup failed: ${error.message}`);

    if (
      !shouldAttemptCollection({
        lastCollectedAt: data?.collected_at ?? null,
        lastAttemptAtMs: null,
        nowMs: now,
      })
    ) {
      return "fresh";
    }

    inFlight.add(key);
    lastAttemptAtMs.set(key, now);
    logger.info("[trending] auto-collect start", { destination });
    const result = await collectTrendingPois(destination);
    logger.info("[trending] auto-collect done", {
      destination,
      resolved: result.resolved,
      signalsUpserted: result.signalsUpserted,
    });
    return "collected";
  } catch (err) {
    lastAttemptAtMs.set(key, now);
    logger.warn("[trending] auto-collect failed", {
      destination,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  } finally {
    inFlight.delete(key);
  }
}
