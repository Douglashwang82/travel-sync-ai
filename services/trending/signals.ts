// ─────────────────────────────────────────────────────────────────────────────
// Trending signals — read side of the social-media trending POI system.
//
// The collector (services/trending/collector.ts) writes one row per
// (destination, place) into `poi_trending_signals` with a raw buzz score in
// [0,1]. This module turns those rows into an effective, recency-decayed
// trend score and blends it into the POI-picking shortlist:
//
//   • boost: candidates already in the shortlist get their similarity nudged
//     up proportionally to the trend score, and a "trending" tag so the LLM
//     pick prompt can see the signal.
//   • inject: top trending places missing from the shortlist are loaded from
//     the corpus and appended, so a hot new spot the vibe query didn't rank
//     still gets in front of the LLM.
//
// Decay: half-life of 7 days. A signal collected today counts fully; after a
// week it counts half; after ~a month it is noise and is filtered out.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadPoisByIds, type PoiCandidate } from "@/services/trip-generation/poi-engine";

export const TRENDING_TAG = "trending";

/** Half-life of a trending signal, in days. */
export const TREND_HALF_LIFE_DAYS = 7;

/** Signals older than this contribute nothing and are ignored entirely. */
export const TREND_MAX_AGE_DAYS = 30;

/** Max similarity boost a fully-hot (score 1, age 0) signal can add. */
export const TREND_BOOST_WEIGHT = 0.15;

/** How many missing trending places get injected into the shortlist. */
export const TREND_INJECT_LIMIT = 5;

export interface TrendingSignal {
  placeId: string;
  poiName: string;
  platforms: string[];
  reason: string;
  rawScore: number;
  collectedAt: string;
}

/**
 * Recency-decayed effective score: rawScore · 0.5^(ageDays / halfLife).
 * Returns 0 for signals past TREND_MAX_AGE_DAYS or with invalid timestamps.
 */
export function computeTrendScore(signal: TrendingSignal, now: Date = new Date()): number {
  const collected = new Date(signal.collectedAt).getTime();
  if (!Number.isFinite(collected)) return 0;
  const ageDays = (now.getTime() - collected) / 86_400_000;
  if (ageDays < 0 || ageDays > TREND_MAX_AGE_DAYS) return 0;
  const raw = Math.min(1, Math.max(0, signal.rawScore));
  return raw * Math.pow(0.5, ageDays / TREND_HALF_LIFE_DAYS);
}

/**
 * Boost shortlist candidates that carry a trending signal. Pure — returns new
 * candidate objects; input order is preserved except that callers are expected
 * to re-sort by similarity afterwards (blendTrendingSignals does).
 */
export function applyTrendingBoost(
  pois: PoiCandidate[],
  scoreByPlaceId: Map<string, number>
): PoiCandidate[] {
  return pois.map((p) => {
    const score = scoreByPlaceId.get(p.placeId) ?? 0;
    if (score <= 0) return p;
    return {
      ...p,
      similarity: Math.min(1, p.similarity + TREND_BOOST_WEIGHT * score),
      tags: p.tags.includes(TRENDING_TAG) ? p.tags : [...p.tags, TRENDING_TAG],
    };
  });
}

/**
 * Fetch live (non-expired) trending signals for a destination, keyed by
 * place_id with the decayed effective score already computed.
 */
export async function getTrendingScores(
  destination: string,
  genId?: string
): Promise<Map<string, number>> {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - TREND_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("poi_trending_signals")
    .select("place_id, poi_name, platforms, reason, raw_score, collected_at")
    .ilike("destination_name", destination.trim())
    .gte("collected_at", cutoff);

  if (error) {
    logger.warn("[trending] signal lookup failed, skipping boost", {
      genId,
      error: String(error.message ?? error),
    });
    return new Map();
  }

  const now = new Date();
  const scores = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    place_id: string;
    poi_name: string;
    platforms: string[] | null;
    reason: string | null;
    raw_score: number;
    collected_at: string;
  }>) {
    const score = computeTrendScore(
      {
        placeId: row.place_id,
        poiName: row.poi_name,
        platforms: row.platforms ?? [],
        reason: row.reason ?? "",
        rawScore: Number(row.raw_score),
        collectedAt: row.collected_at,
      },
      now
    );
    if (score > 0) scores.set(row.place_id, score);
  }
  return scores;
}

/**
 * Full blend used by the generation pipeline after re-ranking:
 *   1. boost in-shortlist candidates carrying a live signal,
 *   2. inject up to TREND_INJECT_LIMIT trending places the shortlist missed
 *      (loaded from the corpus so they arrive geocoded and typed),
 *   3. re-sort by similarity.
 *
 * Fails open: any error path returns the input unchanged — trending data must
 * never block a generation.
 */
export async function blendTrendingSignals(
  destination: string,
  pois: PoiCandidate[],
  genId?: string
): Promise<PoiCandidate[]> {
  try {
    return await blendTrendingSignalsUnsafe(destination, pois, genId);
  } catch (err) {
    logger.warn("[trending] blend failed, continuing without signals", {
      genId,
      destination,
      error: err instanceof Error ? err.message : String(err),
    });
    return pois;
  }
}

async function blendTrendingSignalsUnsafe(
  destination: string,
  pois: PoiCandidate[],
  genId?: string
): Promise<PoiCandidate[]> {
  const scores = await getTrendingScores(destination, genId);
  if (scores.size === 0) return pois;

  const boosted = applyTrendingBoost(pois, scores);

  const present = new Set(pois.map((p) => p.placeId));
  const missingIds = Array.from(scores.entries())
    .filter(([placeId]) => !present.has(placeId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TREND_INJECT_LIMIT)
    .map(([placeId]) => placeId);

  let injected: PoiCandidate[] = [];
  if (missingIds.length > 0) {
    const loaded = await loadPoisByIds(missingIds, genId);
    injected = applyTrendingBoost(
      // Injected rows compete on trend score alone — give them a neutral
      // baseline instead of loadPoisByIds' curated 1.0 so they don't leapfrog
      // every vibe-matched candidate.
      loaded.map((p) => ({ ...p, similarity: 0.6 })),
      scores
    );
  }

  const out = [...boosted, ...injected].sort((a, b) => b.similarity - a.similarity);
  logger.info("[trending] blended signals into shortlist", {
    genId,
    destination,
    liveSignals: scores.size,
    boosted: boosted.filter((p) => p.tags.includes(TRENDING_TAG)).length,
    injected: injected.length,
  });
  return out;
}
