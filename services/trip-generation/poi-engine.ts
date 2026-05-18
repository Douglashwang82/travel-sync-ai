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
}

/**
 * Build the embedding query text from survey signals. Kept short and concrete —
 * embedding models match meaning, not adjective count.
 */
function buildVibeQuery(input: VibeSearchInput): string {
  const vibes = (input.vibe ?? []).join(", ") || "balanced";
  const pace = input.pace ?? "balanced";
  const budget = input.budget ?? "mid";
  return `Travel experiences in ${input.destination} for a ${pace}-paced, ${budget}-budget trip with a ${vibes} vibe.`;
}

export async function searchPoisByVibe(input: VibeSearchInput): Promise<PoiCandidate[]> {
  const k = input.k ?? 30;
  const db = createAdminClient();

  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(buildVibeQuery(input));
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return liveTextSearchFallback(input, k);
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
    console.error("[poi-engine] vector RPC failed", error);
    return liveTextSearchFallback(input, k);
  }

  const rows = (data ?? []) as Array<{
    place_id: string;
    name: string;
    item_type: string;
    tags: string[] | null;
    description: string | null;
    lat: number | null;
    lng: number | null;
    similarity: number;
  }>;

  if (rows.length === 0) return liveTextSearchFallback(input, k);

  return rows.map((r) => ({
    placeId: r.place_id,
    name: r.name,
    itemType: coerceItemType(r.item_type),
    tags: r.tags ?? [],
    description: r.description ?? "",
    lat: r.lat,
    lng: r.lng,
    similarity: r.similarity,
  }));
}

/**
 * Cold-start path. Bypasses the corpus; queries Google Places text search
 * directly per item-type bucket. Returns lower-similarity candidates (0.5
 * sentinel) so the orchestrator can detect the fallback if it cares.
 */
async function liveTextSearchFallback(input: VibeSearchInput, k: number): Promise<PoiCandidate[]> {
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
        similarity: 0.5,
      });
    }
  }
  return results.slice(0, k);
}

/**
 * Load specific place_ids from the embeddings corpus as PoiCandidate rows.
 * Used by the orchestrator to materialize route place_ids alongside the
 * vibe-searched candidates so the solver and enrichment treat both uniformly.
 *
 * `similarity` is set to 1.0 — routes are pre-curated, they don't need to
 * compete with vibe-search scores.
 */
export async function loadPoisByIds(placeIds: string[]): Promise<PoiCandidate[]> {
  const unique = Array.from(new Set(placeIds.filter((id) => id && id.length > 0)));
  if (unique.length === 0) return [];

  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, name, item_type, tags, description, lat, lng, live_data")
    .in("place_id", unique);
  if (error) {
    console.error("[poi-engine] loadPoisByIds failed", error);
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
    similarity: 1,
    liveData: r.live_data,
  }));
}

export async function enrichWithLiveData(candidates: PoiCandidate[]): Promise<EnrichedPoi[]> {
  // Split: curated rows already carry liveData; only fetch live details for
  // the rest (typically Google-sourced place_ids).
  const needsFetch = candidates.filter((c) => c.liveData == null).map((c) => c.placeId);
  const fetched = needsFetch.length > 0 ? await getPlaceDetailsBatch(needsFetch) : [];
  const byId = new Map(fetched.map((l) => [l.placeId, l]));

  return candidates.map((c) => {
    const l = c.liveData ?? byId.get(c.placeId) ?? null;
    // Promote the live lat/lng onto the candidate so downstream code never has to
    // remember which field to read.
    if (l && (c.lat == null || c.lng == null)) {
      c.lat = l.lat ?? c.lat;
      c.lng = l.lng ?? c.lng;
    }
    return { ...c, live: l };
  });
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
