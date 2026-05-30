// ─────────────────────────────────────────────────────────────────────────────
// Route Engine — curated 1-day routes above the POI corpus.
//
// The orchestrator queries this layer before the POI tier. When a route
// clears the hard similarity gate, the solver receives its place_ids in
// curator order (no permutation). When no route clears the gate for a
// destination, the orchestrator falls through to today's POI flow.
//
//   • searchRoutesByVibe(): pgvector ANN over `route_templates`, layered with
//     boost / quality_score / pinned_vibes bonuses in TypeScript so we can
//     tune weights without a migration. Lazy health check drops routes that
//     reference dead place_ids.
//   • composeFromRoutes(): greedy packer that fills `duration_days` slots
//     with the top-scoring routes, avoiding place_id collisions across days.
//
// The LLM is never asked to pick within a route. Routes are a quality
// shortcut, not a substitute for the repair loop — if a route fails at
// solve time, the orchestrator drops it and re-plans that day via the
// POI flow.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { generateEmbedding, GeminiUnavailableError } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import type { SurveyAnswers } from "./index";

export interface RouteCandidate {
  routeId: string;
  title: string;
  summary: string;
  vibeTags: string[];
  pace: NonNullable<SurveyAnswers["pace"]>;
  placeIds: string[];
  similarity: number;
  boost: number;
  qualityScore: number;
  pinnedVibes: string[];
  finalScore: number;
  /** Provenance of this route (e.g. 'curated', 'synthesized'). */
  source: string;
}

export interface RouteSearchInput {
  destination: string;
  vibe: SurveyAnswers["vibe"];
  pace: SurveyAnswers["pace"];
  budget: SurveyAnswers["budget_tier"];
  k?: number;
  /** Optional trace correlation id for logging. */
  genId?: string;
}

export interface RouteComposition {
  /** day_number (1-indexed) → route chosen for that day. */
  coveredDays: Map<number, RouteCandidate>;
  /** day_numbers still needing the POI flow. */
  uncoveredDays: number[];
  /** Union of place_ids used across covered days. */
  usedPlaceIds: Set<string>;
}

// ─── Tunables ────────────────────────────────────────────────────────────────
// All score weights live here so promotion behaviour is one diff away.

export const ROUTE_TUNABLES = {
  W_SIMILARITY: 1.0,
  W_BOOST: 1.0,
  W_QUALITY: 0.2,
  PIN_BONUS: 0.1,
  GATE: 0.72,
} as const;

// ─── Embedding query ─────────────────────────────────────────────────────────
// Mirrors buildVibeQuery in poi-engine.ts so routes and POIs share a semantic
// space — critical for downstream comparisons and for the seed script which
// embeds with the same shape.

function buildRouteQuery(input: RouteSearchInput): string {
  const vibes = (input.vibe ?? []).join(", ") || "balanced";
  const pace = input.pace ?? "balanced";
  const budget = input.budget ?? "mid";
  return `Travel experiences in ${input.destination} for a ${pace}-paced, ${budget}-budget trip with a ${vibes} vibe.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function searchRoutesByVibe(input: RouteSearchInput): Promise<RouteCandidate[]> {
  const k = input.k ?? 10;
  const genId = input.genId;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(buildRouteQuery(input));
  } catch (err) {
    // Routes are a "shortcut" tier — we return empty on Gemini failure rather
    // than throwing. The orchestrator will degrade to the POI flow, which has
    // its own Gemini-unavailable handling.
    if (err instanceof GeminiUnavailableError) {
      logger.warn("[route-engine] embedding unavailable, returning empty", { genId });
      return [];
    }
    throw err;
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc("search_routes_by_vibe", {
    p_destination: input.destination,
    p_query_embedding: queryEmbedding,
    p_pace: input.pace ?? null,
    p_limit: k,
  });
  if (error) {
    logger.error("[route-engine] vector RPC failed", { genId, error: String(error.message ?? error) });
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    summary: string;
    vibe_tags: string[] | null;
    pace: RouteCandidate["pace"];
    place_ids: string[];
    boost: number | string;
    quality_score: number | string;
    pinned_vibes: string[] | null;
    source: string | null;
    similarity: number;
  }>;
  if (rows.length === 0) {
    logger.info("[route-engine] no rows from RPC", { genId, destination: input.destination, pace: input.pace ?? undefined });
    return [];
  }

  const requestVibes = new Set(input.vibe ?? []);
  const scored = rows.map<RouteCandidate>((r) => {
    const pinned = r.pinned_vibes ?? [];
    const pinHit = pinned.some((v) => requestVibes.has(v as never));
    const boost = Number(r.boost) || 0;
    const quality = Number(r.quality_score) || 0;
    const finalScore =
      r.similarity * ROUTE_TUNABLES.W_SIMILARITY +
      boost * ROUTE_TUNABLES.W_BOOST +
      quality * ROUTE_TUNABLES.W_QUALITY +
      (pinHit ? ROUTE_TUNABLES.PIN_BONUS : 0);

    return {
      routeId: r.id,
      title: r.title,
      summary: r.summary,
      vibeTags: r.vibe_tags ?? [],
      pace: r.pace,
      placeIds: r.place_ids,
      similarity: r.similarity,
      boost,
      qualityScore: quality,
      pinnedVibes: pinned,
      finalScore,
      source: r.source ?? "curated",
    };
  });

  const gated = scored.filter((c) => c.finalScore >= ROUTE_TUNABLES.GATE);
  logger.info("[route-engine] scored & gated", {
    genId,
    rows: rows.length,
    passingGate: gated.length,
    gate: ROUTE_TUNABLES.GATE,
    topScores: scored
      .slice()
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 5)
      .map((c) => `${c.title}=${c.finalScore.toFixed(3)}`)
      .join(" | "),
  });
  if (gated.length === 0) return [];

  const healthy = await filterHealthy(gated, genId);
  healthy.sort((a, b) => b.finalScore - a.finalScore);
  if (healthy.length !== gated.length) {
    logger.info("[route-engine] health filter dropped routes", {
      genId,
      before: gated.length,
      after: healthy.length,
    });
  }
  return healthy;
}

export interface ExplorableRoute {
  routeId: string;
  title: string;
  summary: string;
  vibeTags: string[];
  pace: string;
  placeIds: string[];
  qualityScore: number;
}

/**
 * Explorer-facing route listing. Returns the curated routes for a destination
 * ordered by promotion levers (boost desc, then quality_score desc) WITHOUT the
 * vibe-similarity gate the generator applies — the map explorer wants to show
 * the full menu of routes for a place, not a vibe-filtered shortlist. Place
 * resolution (place_ids → coordinates) is left to the caller via
 * loadPoisByIds so this stays a single table read.
 */
export async function listRoutesForDestination(
  destination: string,
  limit = 20
): Promise<ExplorableRoute[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("route_templates")
    .select("id, title, summary, vibe_tags, pace, place_ids, quality_score, boost")
    .eq("is_archived", false)
    .ilike("destination_name", destination)
    .order("boost", { ascending: false })
    .order("quality_score", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("[route-engine] listRoutesForDestination failed", {
      error: String(error.message ?? error),
    });
    return [];
  }
  return (data ?? []).map((r) => ({
    routeId: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
    vibeTags: (r.vibe_tags as string[] | null) ?? [],
    pace: r.pace as string,
    placeIds: (r.place_ids as string[] | null) ?? [],
    qualityScore: Number(r.quality_score) || 0,
  }));
}

/**
 * Greedy packer. Walks `duration_days` slots in order; assigns the top-scoring
 * route whose place_ids don't collide with any already-picked. Routes are
 * never reused across days — repetition is more jarring than a half-route
 * itinerary.
 */
export function composeFromRoutes(
  routes: RouteCandidate[],
  durationDays: number
): RouteComposition {
  const coveredDays = new Map<number, RouteCandidate>();
  const usedPlaceIds = new Set<string>();
  const usedRouteIds = new Set<string>();

  for (let day = 1; day <= durationDays; day++) {
    const pick = routes.find(
      (r) =>
        !usedRouteIds.has(r.routeId) &&
        !r.placeIds.some((id) => usedPlaceIds.has(id))
    );
    if (!pick) continue;
    coveredDays.set(day, pick);
    usedRouteIds.add(pick.routeId);
    for (const id of pick.placeIds) usedPlaceIds.add(id);
  }

  const uncoveredDays: number[] = [];
  for (let day = 1; day <= durationDays; day++) {
    if (!coveredDays.has(day)) uncoveredDays.push(day);
  }

  return { coveredDays, uncoveredDays, usedPlaceIds };
}

// ─── Lazy health check ───────────────────────────────────────────────────────
// Drop routes whose place_ids no longer all exist in poi_embeddings, and
// mark their last_health_fail_at. Healthy routes get last_health_ok_at bumped
// so a quality cron can prune ones that haven't been touched in months.

async function filterHealthy(candidates: RouteCandidate[], genId?: string): Promise<RouteCandidate[]> {
  if (candidates.length === 0) return [];
  const db = createAdminClient();

  const allIds = Array.from(new Set(candidates.flatMap((c) => c.placeIds)));
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id")
    .in("place_id", allIds);
  if (error) {
    // On lookup failure, return the candidates unchanged — health is opportunistic.
    logger.error("[route-engine] health lookup failed", { genId, error: String(error.message ?? error) });
    return candidates;
  }

  const alive = new Set((data ?? []).map((r) => r.place_id as string));
  const healthy: RouteCandidate[] = [];
  const failed: string[] = [];
  for (const c of candidates) {
    if (c.placeIds.every((id) => alive.has(id))) healthy.push(c);
    else failed.push(c.routeId);
  }

  const now = new Date().toISOString();
  if (healthy.length > 0) {
    await db
      .from("route_templates")
      .update({ last_health_ok_at: now })
      .in("id", healthy.map((c) => c.routeId));
  }
  if (failed.length > 0) {
    await db.from("route_templates").update({ last_health_fail_at: now }).in("id", failed);
  }

  return healthy;
}
