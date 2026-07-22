// ─────────────────────────────────────────────────────────────────────────────
// Trending POI collector — write side of the social-media trending system.
//
// For a destination, in three steps:
//
//   1. discover  — Gemini with Google Search grounding ("what is trending on
//                  Instagram / TikTok / Reddit / YouTube for <destination>
//                  right now?"). Keyless: same approach as the
//                  social_media_photos agent, no scraping API.
//   2. extract   — a second, non-grounded generateJson pass turns the grounded
//                  prose into structured {name, type, platforms, buzz, reason}
//                  items (search grounding can't be combined with JSON mode).
//   3. resolve   — each item is resolved to a real Google place_id via Places
//                  text search; unresolvable names are dropped, never guessed.
//
// Results are persisted twice:
//   • poi_trending_signals — one scored signal row per (destination, place),
//     read by services/trending/signals.ts during the POI-picking phase.
//   • poi_embeddings — places not yet in the corpus are upserted with
//     source 'social_trending' so vibe vector search can retrieve them too.
//
// Invoked by the trending-pois cron and scripts/collect-trending-pois.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  generateJson,
  generateTextWithSearch,
  type GroundedWebSource,
} from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { findDestinationPlace, getPlaceDetails } from "@/services/decisions/places";
import { generateEmbeddingWithRetry } from "@/services/admin/embedding-retry";
import { TRENDING_TAG } from "./signals";

const PLATFORMS = ["instagram", "tiktok", "reddit", "youtube", "blog", "news", "other"] as const;

const TrendingItemSchema = z.object({
  name: z.string().min(2).max(120),
  item_type: z.enum(["hotel", "restaurant", "activity", "other"]).default("activity"),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  /** Collector-judged buzz strength in [0,1]. */
  buzz: z.number().min(0).max(1).default(0.5),
  reason: z.string().max(300).default(""),
});

const ExtractionSchema = z.object({
  pois: z.array(TrendingItemSchema).max(20).default([]),
});

type TrendingItem = z.infer<typeof TrendingItemSchema>;

/** Hard cap on Places lookups per collection run — resolution is the paid step. */
const MAX_RESOLVE = 12;

export interface CollectResult {
  destination: string;
  discovered: number;
  resolved: number;
  newCorpusRows: number;
  signalsUpserted: number;
  errors: string[];
}

export async function collectTrendingPois(destination: string): Promise<CollectResult> {
  const dest = destination.trim();
  const result: CollectResult = {
    destination: dest,
    discovered: 0,
    resolved: 0,
    newCorpusRows: 0,
    signalsUpserted: 0,
    errors: [],
  };

  // 1. Discover via search-grounded Gemini.
  const monthYear = new Date().toISOString().slice(0, 7);
  const grounded = await generateTextWithSearch(
    "You are a travel-trends researcher. Use Google Search to find places that are CURRENTLY trending or going viral on social media for the given destination. " +
      "Focus on concrete, named, visitable places (restaurants, cafes, attractions, viewpoints, shops, hotels, experiences) — not events, generic neighborhoods, or whole cities. " +
      "Prefer signals from Instagram, TikTok, Reddit, YouTube travel vlogs, and recent travel blogs/news. For each place, note which platforms it is buzzing on and why.",
    `Destination: ${dest}. As of ${monthYear}, list up to 15 specific places currently trending on social media there.`
  );
  if (!grounded.text.trim()) {
    result.errors.push("grounded search returned empty text");
    return result;
  }

  // 2. Extract structured items (grounding and JSON mode are mutually
  //    exclusive, so this is a separate non-grounded pass).
  const extraction = await generateJson(
    "Extract the trending places from the research notes into JSON. Only include concrete named places actually present in the notes — never invent or pad. " +
      "buzz reflects how strong/recent the social-media buzz appears (0.3 = a single mention, 0.6 = repeated mentions, 0.9 = clearly viral). " +
      'Respond as { "pois": [{ "name", "item_type": "hotel"|"restaurant"|"activity"|"other", "platforms": ["instagram"|"tiktok"|"reddit"|"youtube"|"blog"|"news"|"other"], "buzz": 0..1, "reason" }] }',
    JSON.stringify({
      destination: dest,
      research_notes: grounded.text.slice(0, 12_000),
      sources: grounded.sources.slice(0, 20).map((s) => s.title || s.domain),
    }),
    ExtractionSchema
  );
  result.discovered = extraction.pois.length;
  logger.info("[trending] discovery", {
    destination: dest,
    discovered: result.discovered,
    sources: grounded.sources.length,
    names: extraction.pois.slice(0, 10).map((p) => p.name).join(" | ") || "(none)",
  });
  if (extraction.pois.length === 0) return result;

  // 3. Resolve to Google place_ids and persist.
  const db = createAdminClient();
  const seen = new Set<string>();
  for (const item of extraction.pois.slice(0, MAX_RESOLVE)) {
    try {
      const place = await findDestinationPlace(`${item.name}, ${dest}`);
      if (!place?.placeId) {
        result.errors.push(`unresolved: ${item.name}`);
        continue;
      }
      if (seen.has(place.placeId)) continue;
      seen.add(place.placeId);
      result.resolved++;

      const isNew = await ensureCorpusRow(db, dest, place.placeId, place.name, item);
      if (isNew) result.newCorpusRows++;

      const { error } = await db.from("poi_trending_signals").upsert(
        {
          place_id: place.placeId,
          destination_name: dest,
          poi_name: place.name,
          platforms: item.platforms,
          reason: item.reason,
          evidence: matchEvidence(item, grounded.sources),
          raw_score: item.buzz,
          collected_at: new Date().toISOString(),
        },
        { onConflict: "destination_name,place_id" }
      );
      if (error) {
        result.errors.push(`signal upsert failed for ${place.name}: ${error.message}`);
      } else {
        result.signalsUpserted++;
      }
    } catch (err) {
      result.errors.push(`${item.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info("[trending] collection done", {
    ...result,
    errors: result.errors.slice(0, 5).join(" | ") || "(none)",
  });
  return result;
}

/**
 * Upsert the place into poi_embeddings when it isn't there yet, so vector
 * retrieval can surface it — with real coordinates from Places details, which
 * the index-page wall and the solver both require. Existing rows (curated,
 * google_places, …) are left untouched except for a coordinate backfill when
 * they lack lat/lng. Deliberately does NOT write place_details_cache: these
 * are live Google place_ids, and a coords-only cache entry would starve
 * enrichWithLiveData of opening hours for the cache TTL.
 * Returns true when a new corpus row was created.
 */
async function ensureCorpusRow(
  db: ReturnType<typeof createAdminClient>,
  destination: string,
  placeId: string,
  placeName: string,
  item: TrendingItem
): Promise<boolean> {
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, lat, lng")
    .eq("place_id", placeId)
    .maybeSingle();
  if (error) {
    logger.warn("[trending] corpus lookup failed", { placeId, error: error.message });
    return false;
  }
  if (data && data.lat != null && data.lng != null) return false;

  const details = await getPlaceDetails(placeId);

  if (data) {
    // Row exists but has no coordinates (e.g. collected before details were
    // fetched here) — backfill so it becomes usable by the wall and solver.
    if (details?.lat != null && details?.lng != null) {
      const { error: updateError } = await db
        .from("poi_embeddings")
        .update({ lat: details.lat, lng: details.lng, last_seen_at: new Date().toISOString() })
        .eq("place_id", placeId);
      if (updateError) {
        logger.warn("[trending] coord backfill failed", { placeId, error: updateError.message });
      }
    }
    return false;
  }

  const description = [
    placeName,
    `${item.item_type} in ${destination}`,
    details?.address ?? null,
    item.reason ? `trending on ${item.platforms.join(", ") || "social media"}: ${item.reason}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  try {
    const embedding = await generateEmbeddingWithRetry(description, { label: placeId });
    const { error: insertError } = await db.from("poi_embeddings").upsert(
      {
        place_id: placeId,
        destination_name: destination,
        name: placeName,
        item_type: item.item_type,
        tags: dedupeTags([TRENDING_TAG, ...item.platforms]),
        description,
        embedding,
        lat: details?.lat ?? null,
        lng: details?.lng ?? null,
        source: "social_trending",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );
    if (insertError) {
      logger.warn("[trending] corpus upsert failed", { placeId, error: insertError.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[trending] corpus upsert failed", {
      placeId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 16);
}

/**
 * Best-effort pairing of grounding sources to an extracted item: sources whose
 * title mentions the place name, falling back to the first few sources so the
 * evidence column is never empty when grounding returned anything.
 */
function matchEvidence(item: TrendingItem, sources: GroundedWebSource[]): GroundedWebSource[] {
  const needle = item.name.toLowerCase();
  const matched = sources.filter((s) => s.title.toLowerCase().includes(needle));
  return (matched.length > 0 ? matched : sources.slice(0, 3)).slice(0, 5);
}
