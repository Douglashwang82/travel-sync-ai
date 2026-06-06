// ─────────────────────────────────────────────────────────────────────────────
// POI Engine — Tier 2 of the v1.2 itinerary generator.
//
//   • searchPoisByVibe(): pgvector ANN over the seeded `poi_embeddings` corpus,
//     filtered hard by destination so vector neighbors can't bleed across cities.
//   • enrichWithLiveData(): batches Google Places details for the candidates so
//     the solver has opening-hours and lat/lng to enforce.
//
// The orchestrator composes these two steps before any LLM "pick" happens, so
// the model never sees raw freeform candidate generation — only a shortlist of
// real, geocoded, time-bounded places.
//
// Fallback: if the embeddings corpus is cold for a destination, we fall back
// to a live Google Places text search keyed by vibe — degraded quality, but
// the pipeline keeps moving.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { generateEmbedding, GeminiUnavailableError } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import {
  getPlaceDetailsBatch,
  searchPlaces,
  type PlaceLiveData,
} from "@/services/decisions/places";
import type { ItemType } from "@/lib/types";
import type { SurveyAnswers } from "./index";

export interface PoiCandidate {
  placeId: string;
  name: string;
  itemType: "hotel" | "restaurant" | "activity" | "transport" | "other";
  tags: string[];
  description: string;
  lat: number | null;
  lng: number | null;
  similarity: number;
  /** Provenance of this POI (e.g. 'google_places', 'admin_upload', 'google_places_live'). */
  source: string;
  /**
   * Curated rows (non-Google place_ids) carry their own live data here so
   * enrichWithLiveData doesn't waste a Google call that would 404. Null for
   * Google-sourced rows; those still flow through getPlaceDetailsBatch.
   */
  liveData?: PlaceLiveData | null;
}

export interface EnrichedPoi extends PoiCandidate {
  live: PlaceLiveData | null;
}

export interface VibeSearchInput {
  destination: string;
  vibe: SurveyAnswers["vibe"];
  pace: SurveyAnswers["pace"];
  budget: SurveyAnswers["budget_tier"];
  itemTypes?: Array<PoiCandidate["itemType"]>;
  k?: number;
  /** Optional trace correlation id for logging. */
  genId?: string;
}

export interface VibeSearchResult {
  pois: PoiCandidate[];
  /**
   * The embedding generated for the vibe query, or null when the corpus
   * fallback ran (embedding was unavailable). Passed to rerankCandidates
   * and recordFeedback so the orchestrator doesn't re-embed.
   */
  queryEmbedding: number[] | null;
}

/**
 * Build the embedding query text from survey signals. Kept short and concrete —
 * embedding models match meaning, not adjective count.
 */
export function buildVibeQuery(input: VibeSearchInput): string {
  const vibes = (input.vibe ?? []).join(", ") || "balanced";
  const pace = input.pace ?? "balanced";
  const budget = input.budget ?? "mid";
  return `Travel experiences in ${input.destination} for a ${pace}-paced, ${budget}-budget trip with a ${vibes} vibe.`;
}

export async function searchPoisByVibe(input: VibeSearchInput): Promise<VibeSearchResult> {
  const k = input.k ?? 30;
  const genId = input.genId;
  const db = createAdminClient();

  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(buildVibeQuery(input));
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      logger.warn("[poi-engine] embedding unavailable, falling back to live text search", { genId });
      return { pois: await liveTextSearchFallback(input, k, genId), queryEmbedding: null };
    }
    throw err;
  }

  const { data, error } = await db.rpc("search_pois_by_vibe", {
    p_destination: input.destination,
    p_query_embedding: queryEmbedding,
    p_item_types: input.itemTypes ?? null,
    p_limit: k,
  });
  if (error) {
    logger.error("[poi-engine] vector RPC failed", { genId, error: String(error.message ?? error) });
    return { pois: await liveTextSearchFallback(input, k, genId), queryEmbedding: null };
  }

  const rows = (data ?? []) as Array<{
    place_id: string;
    name: string;
    item_type: string;
    tags: string[] | null;
    description: string | null;
    lat: number | null;
    lng: number | null;
    source: string;
    live_data?: PlaceLiveData | null;
    similarity: number;
  }>;

  if (rows.length === 0) {
    logger.warn("[poi-engine] vector search returned 0 rows, falling back", {
      genId,
      destination: input.destination,
    });
    return { pois: await liveTextSearchFallback(input, k, genId), queryEmbedding: null };
  }

  logger.info("[poi-engine] vector search", {
    genId,
    rows: rows.length,
    topSim: rows[0].similarity.toFixed(3),
    bottomSim: rows[rows.length - 1].similarity.toFixed(3),
  });

  return {
    pois: rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      itemType: coerceItemType(r.item_type),
      tags: r.tags ?? [],
      description: r.description ?? "",
      lat: r.lat,
      lng: r.lng,
      source: r.source,
      similarity: r.similarity,
      liveData: r.live_data ?? null,
    })),
    queryEmbedding,
  };
}

export interface PoiTextSearchInput {
  destination: string;
  /** Free-text query typed in the map explorer; blank → "top experiences". */
  query?: string;
  itemTypes?: Array<PoiCandidate["itemType"]>;
  k?: number;
}

/**
 * Explorer-facing POI search. Same corpus + RPC as searchPoisByVibe, but keyed
 * on a free-text query the user typed in the map explorer rather than
 * survey-derived vibe signals. A blank query falls back to a generic
 * "top experiences in <destination>" embedding so the explorer has something to
 * show the moment a destination is selected.
 *
 * Unlike the generator path this does NOT fall back to live Google text search
 * on a cold corpus — the explorer surfaces Google results through its own live
 * search lane, so an empty curated result here is a meaningful "no curated POIs
 * for this place yet", not a failure to paper over.
 */
export async function searchPoisByText(input: PoiTextSearchInput): Promise<PoiCandidate[]> {
  const k = input.k ?? 24;
  const db = createAdminClient();
  const queryText =
    input.query?.trim() ||
    `Top travel experiences and places to visit in ${input.destination}.`;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(queryText);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      logger.warn("[poi-engine] explorer embedding unavailable, returning empty");
      return [];
    }
    throw err;
  }

  const { data, error } = await db.rpc("search_pois_by_vibe", {
    p_destination: input.destination,
    p_query_embedding: queryEmbedding,
    p_item_types: input.itemTypes ?? null,
    p_limit: k,
  });
  if (error) {
    logger.error("[poi-engine] explorer RPC failed", { error: String(error.message ?? error) });
    return [];
  }

  const rows = (data ?? []) as Array<{
    place_id: string;
    name: string;
    item_type: string;
    tags: string[] | null;
    description: string | null;
    lat: number | null;
    lng: number | null;
    source: string;
    live_data?: PlaceLiveData | null;
    similarity: number;
  }>;

  return rows.map((r) => ({
    placeId: r.place_id,
    name: r.name,
    itemType: coerceItemType(r.item_type),
    tags: r.tags ?? [],
    description: r.description ?? "",
    lat: r.lat,
    lng: r.lng,
    source: r.source,
    similarity: r.similarity,
    liveData: r.live_data ?? null,
  }));
}

/**
 * Cold-start path. Bypasses the corpus; queries Google Places text search
 * directly per item-type bucket. Returns lower-similarity candidates (0.5
 * sentinel) so the orchestrator can detect the fallback if it cares.
 */
async function liveTextSearchFallback(
  input: VibeSearchInput,
  k: number,
  genId?: string
): Promise<PoiCandidate[]> {
  const buckets: Array<PoiCandidate["itemType"]> =
    input.itemTypes ?? ["activity", "restaurant", "hotel"];
  const perBucket = Math.max(3, Math.ceil(k / buckets.length));

  const results: PoiCandidate[] = [];
  for (const t of buckets) {
    const res = await searchPlaces(input.destination, t as ItemType, perBucket);
    for (const c of res.candidates) {
      results.push({
        placeId: c.placeId,
        name: c.name,
        itemType: t,
        tags: [],
        description: c.name,
        lat: null,
        lng: null,
        source: "google_places_live",
        similarity: 0.5,
      });
    }
  }
  const out = results.slice(0, k);
  logger.info("[poi-engine] live text fallback", {
    genId,
    destination: input.destination,
    buckets: buckets.join(","),
    returned: out.length,
  });
  return out;
}

/**
 * Load specific place_ids from the embeddings corpus as PoiCandidate rows.
 * Used by the orchestrator to materialize route place_ids alongside the
 * vibe-searched candidates so the solver and enrichment treat both uniformly.
 *
 * `similarity` is set to 1.0 — routes are pre-curated, they don't need to
 * compete with vibe-search scores.
 */
export async function loadPoisByIds(placeIds: string[], genId?: string): Promise<PoiCandidate[]> {
  const unique = Array.from(new Set(placeIds.filter((id) => id && id.length > 0)));
  if (unique.length === 0) return [];

  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, name, item_type, tags, description, lat, lng, source, live_data")
    .in("place_id", unique);
  if (error) {
    logger.error("[poi-engine] loadPoisByIds failed", { genId, error: String(error.message ?? error) });
    return [];
  }
  if ((data ?? []).length !== unique.length) {
    logger.warn("[poi-engine] loadPoisByIds: some place_ids not found", {
      genId,
      requested: unique.length,
      found: (data ?? []).length,
    });
  }

  const rows = (data ?? []) as Array<{
    place_id: string;
    name: string;
    item_type: string;
    tags: string[] | null;
    description: string | null;
    lat: number | null;
    lng: number | null;
    source: string;
    live_data: PlaceLiveData | null;
  }>;
  return rows.map((r) => ({
    placeId: r.place_id,
    name: r.name,
    itemType: coerceItemType(r.item_type),
    tags: r.tags ?? [],
    description: r.description ?? "",
    lat: r.lat,
    lng: r.lng,
    source: r.source,
    similarity: 1,
    liveData: r.live_data,
  }));
}

export async function enrichWithLiveData(candidates: PoiCandidate[]): Promise<EnrichedPoi[]> {
  // Split: curated rows already carry liveData; only fetch live details for
  // the rest (typically Google-sourced place_ids).
  const needsFetch = candidates
    .filter((c) => c.liveData == null && shouldFetchLiveDetails(c.placeId))
    .map((c) => c.placeId);
  const fetched = needsFetch.length > 0 ? await getPlaceDetailsBatch(needsFetch) : [];
  const byId = new Map(fetched.map((l) => [l.placeId, l]));

  return candidates.map((c) => {
    const l = c.liveData ?? byId.get(c.placeId) ?? fallbackLiveData(c);
    // Promote the live lat/lng onto the candidate so downstream code never has to
    // remember which field to read.
    if (l && (c.lat == null || c.lng == null)) {
      c.lat = l.lat ?? c.lat;
      c.lng = l.lng ?? c.lng;
    }
    return { ...c, live: l };
  });
}

function shouldFetchLiveDetails(placeId: string): boolean {
  return !placeId.startsWith("local:");
}

function fallbackLiveData(candidate: PoiCandidate): PlaceLiveData | null {
  if (shouldFetchLiveDetails(candidate.placeId)) return null;
  return {
    placeId: candidate.placeId,
    name: candidate.name,
    address: null,
    rating: null,
    priceLevel: null,
    lat: candidate.lat,
    lng: candidate.lng,
    openingPeriods: [],
  };
}

function coerceItemType(raw: string): PoiCandidate["itemType"] {
  switch (raw) {
    case "hotel":
    case "restaurant":
    case "activity":
    case "transport":
    case "other":
      return raw;
    default:
      return "other";
  }
}
