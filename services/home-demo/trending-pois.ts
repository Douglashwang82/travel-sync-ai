// ─────────────────────────────────────────────────────────────────────────────
// Trending POIs for the index-page media wall.
//
// The static lib/home-survey catalog keeps the landing demo working with zero
// connectivity, but it goes stale by design. This module synthesizes live
// HomePoi cards from the social-media trending system (poi_trending_signals +
// poi_embeddings, written by services/trending/collector.ts) so the picking
// wall surfaces what is buzzing on Instagram / TikTok *right now*, merged in
// front of the seeded cards by the client.
//
// Security posture is unchanged: the client only ever sends ids. Trending ids
// are namespaced `trend:<place_id>` and must resolve server-side against the
// corpus before /api/home/itinerary or /api/home/poi-photo will act on them.
// Everything here fails soft — no signals (or no DB) just means the wall shows
// the catalog, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getHomeCategoryMeta,
  getHomeCities,
  getHomeCountry,
  type HomeCountryCode,
  type HomePoi,
  type HomePoiCategory,
} from "@/lib/home-survey";
import { computeTrendScore, TREND_MAX_AGE_DAYS } from "@/services/trending/signals";

export const TRENDING_POI_ID_PREFIX = "trend:";

export function isTrendingPoiId(id: string): boolean {
  return id.startsWith(TRENDING_POI_ID_PREFIX);
}

/** Everything the pure card builder needs, already joined across both tables. */
export interface TrendingPoiSource {
  placeId: string;
  name: string;
  itemType: string;
  tags: string[];
  lat: number;
  lng: number;
  destination: string;
  reason: string;
  platforms: string[];
  /** Recency-decayed effective score, 0–1. */
  score: number;
}

/**
 * Pure HomePoi synthesis — exported for unit tests. Display fields the corpus
 * can't provide (likes, handle, hue) are derived deterministically from the
 * signal so cards are stable across renders.
 */
export function buildTrendingHomePoi(
  src: TrendingPoiSource,
  country: HomeCountryCode,
  cityName: string
): HomePoi {
  const itemType = src.itemType === "restaurant" ? "restaurant" : "activity";
  const category = deriveCategory(itemType, src.tags);
  const platforms = src.platforms.length > 0 ? src.platforms : ["instagram"];
  const blurb = src.reason || `Trending on ${platforms.join(", ")} right now.`;
  return {
    id: `${TRENDING_POI_ID_PREFIX}${src.placeId}`,
    country,
    name: src.name,
    nameZh: src.name,
    city: cityName,
    itemType,
    category,
    tags: dedupe(["trending", ...platforms, ...src.tags]).slice(0, 10),
    lat: src.lat,
    lng: src.lng,
    blurb,
    blurbZh: src.reason || "正在社群媒體上爆紅。",
    media: "insta",
    photoQuery: `${src.name}, ${src.destination}`,
    costUsd: itemType === "restaurant" ? 25 : 15,
    stayMinutes: itemType === "restaurant" ? 75 : 90,
    hue: hashHue(src.placeId),
    emoji: getHomeCategoryMeta(category).emoji,
    handle: toHandle(src.name),
    likes: 800 + Math.round(src.score * 90_000),
    trending: { platforms, score: src.score },
  };
}

// ─── Wall fetch ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000;
// Empty answers expire fast: a cold city usually triggers a background
// auto-collection, and the wall should pick the new cards up on the next
// visit — not hide them behind a 10-minute cache.
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const wallCache = new Map<string, { pois: HomePoi[]; at: number }>();

/**
 * Live trending cards for one country + city, newest-buzz first. Cached
 * in-memory per instance so the public endpoint stays cheap.
 */
export async function getHomeTrendingPois(
  country: HomeCountryCode,
  cityName: string,
  limit = 12
): Promise<HomePoi[]> {
  const key = `${country}:${cityName.toLowerCase()}`;
  const cached = wallCache.get(key);
  const ttl = cached && cached.pois.length === 0 ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
  if (cached && Date.now() - cached.at < ttl) return cached.pois;

  let pois: HomePoi[] = [];
  try {
    pois = await fetchTrendingPois(country, cityName, limit);
  } catch (err) {
    logger.warn("[home-trending] fetch failed, returning empty", {
      country,
      cityName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  wallCache.set(key, { pois, at: Date.now() });
  return pois;
}

async function fetchTrendingPois(
  country: HomeCountryCode,
  cityName: string,
  limit: number
): Promise<HomePoi[]> {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - TREND_MAX_AGE_DAYS * 86_400_000).toISOString();

  const { data: signals, error } = await db
    .from("poi_trending_signals")
    .select("place_id, poi_name, platforms, reason, raw_score, collected_at, destination_name")
    .ilike("destination_name", `%${cityName}%`)
    .gte("collected_at", cutoff);
  if (error) throw new Error(`signal lookup failed: ${error.message}`);

  const now = new Date();
  const scored = (signals ?? [])
    .map((row) => ({
      row,
      score: computeTrendScore(
        {
          placeId: row.place_id,
          poiName: row.poi_name,
          platforms: row.platforms ?? [],
          reason: row.reason ?? "",
          rawScore: Number(row.raw_score),
          collectedAt: row.collected_at,
        },
        now
      ),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    // Overfetch: rows without coordinates are dropped below.
    .slice(0, limit * 2);
  if (scored.length === 0) return [];

  const { data: rows, error: poiError } = await db
    .from("poi_embeddings")
    .select("place_id, name, item_type, tags, lat, lng, destination_name")
    .in(
      "place_id",
      scored.map((s) => s.row.place_id)
    )
    // Admin-hidden POIs never reach the public wall.
    .neq("curation_status", "hidden");
  if (poiError) throw new Error(`corpus lookup failed: ${poiError.message}`);

  const byId = new Map(
    ((rows ?? []) as Array<{
      place_id: string;
      name: string;
      item_type: string;
      tags: string[] | null;
      lat: number | null;
      lng: number | null;
      destination_name: string;
    }>).map((r) => [r.place_id, r])
  );

  const out: HomePoi[] = [];
  for (const { row, score } of scored) {
    const poi = byId.get(row.place_id);
    // The itinerary solver needs coordinates; cards without them can't ship.
    if (!poi || poi.lat == null || poi.lng == null) continue;
    out.push(
      buildTrendingHomePoi(
        {
          placeId: poi.place_id,
          name: poi.name,
          itemType: poi.item_type,
          tags: poi.tags ?? [],
          lat: poi.lat,
          lng: poi.lng,
          destination: poi.destination_name,
          reason: row.reason ?? "",
          platforms: row.platforms ?? [],
          score,
        },
        country,
        cityName
      )
    );
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Single-id resolution (itinerary + photo routes) ──────────────────────────

/**
 * Resolve a `trend:<place_id>` id the client sent back, verifying the place
 * actually belongs to the requested country before trusting it. Returns null
 * for unknown ids, foreign destinations, or rows without coordinates.
 */
export async function getHomeTrendingPoi(
  id: string,
  country: HomeCountryCode
): Promise<HomePoi | null> {
  if (!isTrendingPoiId(id)) return null;
  const placeId = id.slice(TRENDING_POI_ID_PREFIX.length);
  if (!placeId) return null;

  try {
    const db = createAdminClient();
    const [{ data: poi }, { data: signal }] = await Promise.all([
      db
        .from("poi_embeddings")
        .select("place_id, name, item_type, tags, lat, lng, destination_name")
        .eq("place_id", placeId)
        .neq("curation_status", "hidden")
        .maybeSingle(),
      db
        .from("poi_trending_signals")
        .select("platforms, reason, raw_score, collected_at")
        .eq("place_id", placeId)
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!poi || poi.lat == null || poi.lng == null) return null;

    const cityName = matchHomeCity(country, poi.destination_name);
    if (!cityName) return null;

    return buildTrendingHomePoi(
      {
        placeId: poi.place_id,
        name: poi.name,
        itemType: poi.item_type,
        tags: poi.tags ?? [],
        lat: poi.lat,
        lng: poi.lng,
        destination: poi.destination_name,
        reason: signal?.reason ?? "",
        platforms: signal?.platforms ?? [],
        score: signal
          ? computeTrendScore({
              placeId,
              poiName: poi.name,
              platforms: signal.platforms ?? [],
              reason: signal.reason ?? "",
              rawScore: Number(signal.raw_score),
              collectedAt: signal.collected_at,
            })
          : 0,
      },
      country,
      cityName
    );
  } catch (err) {
    logger.warn("[home-trending] id resolution failed", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Photo-proxy hook: the Places text query for a trending id, or null. */
export async function getTrendingPoiPhotoQuery(id: string): Promise<string | null> {
  if (!isTrendingPoiId(id)) return null;
  const placeId = id.slice(TRENDING_POI_ID_PREFIX.length);
  if (!placeId) return null;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("poi_embeddings")
      .select("name, destination_name")
      .eq("place_id", placeId)
      .maybeSingle();
    return data ? `${data.name}, ${data.destination_name}` : null;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Does the corpus destination belong to this home country? Matched against
 * the country's own name and its catalog city names; returns the display city
 * (the matched catalog city, else the destination's leading segment).
 */
function matchHomeCity(country: HomeCountryCode, destination: string): string | null {
  const dest = destination.toLowerCase();
  const homeCountry = getHomeCountry(country);
  if (!homeCountry) return null;
  for (const city of getHomeCities(country)) {
    if (dest.includes(city.name.toLowerCase())) return city.name;
  }
  if (dest.includes(homeCountry.name.toLowerCase())) {
    return destination.split(",")[0].trim() || homeCountry.name;
  }
  return null;
}

function deriveCategory(itemType: "activity" | "restaurant", tags: string[]): HomePoiCategory {
  if (itemType === "restaurant") return "food";
  const t = new Set(tags.map((x) => x.toLowerCase()));
  if (["park", "nature", "hike", "mountain", "beach", "garden", "onsen"].some((x) => t.has(x))) return "nature";
  if (["museum", "gallery", "art"].some((x) => t.has(x))) return "museum";
  if (["bar", "nightlife", "club", "izakaya"].some((x) => t.has(x))) return "nightlife";
  if (["temple", "shrine", "culture", "heritage", "market"].some((x) => t.has(x))) return "culture";
  return "landmark";
}

function toHandle(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);
  return slug || "trending.now";
}

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean)));
}
