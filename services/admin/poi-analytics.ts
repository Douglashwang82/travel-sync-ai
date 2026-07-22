// ─────────────────────────────────────────────────────────────────────────────
// POI ranking analytics — the read models behind /admin/pois/analytics.
//
// Joins three signal sources into per-POI and corpus-level views built to
// answer one question: "what should a ranking algorithm weigh?"
//   • itinerary_feedback aggregates (admin_poi_stats RPC): exposure, selection
//     rate, average vector rank, and the selected-vs-rejected similarity split
//     — the ground truth of what the LLM pick actually chooses;
//   • poi_trending_signals: recency-decayed social buzz per place;
//   • poi_embeddings curation fields: category / status / quality priors.
//
// The rollups are pure functions over fetched rows so they are unit-testable
// and cheap — the corpus is hundreds of rows, not millions.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { computeTrendScore, TREND_MAX_AGE_DAYS } from "@/services/trending/signals";

export interface PoiStatsRow {
  place_id: string;
  exposures: number;
  selections: number;
  selection_rate: number;
  avg_shortlist_rank: number;
  avg_similarity: number;
  avg_similarity_selected: number | null;
  avg_similarity_rejected: number | null;
  last_exposure_at: string;
}

export interface RankBucketRow {
  bucket_start: number;
  exposures: number;
  selections: number;
  selection_rate: number;
}

export interface CorpusPoiRow {
  place_id: string;
  name: string;
  destination_name: string;
  item_type: string;
  source: string;
  category: string | null;
  labels: string[];
  curation_status: string;
  quality_score: number | null;
}

/** Per-place feedback aggregates, keyed by place_id. Fails soft to empty. */
export async function fetchPoiStats(destination?: string): Promise<Map<string, PoiStatsRow>> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("admin_poi_stats", {
    p_destination: destination?.trim() || null,
  });
  if (error) {
    logger.warn("[poi-analytics] admin_poi_stats failed", { error: error.message });
    return new Map();
  }
  return new Map(((data ?? []) as PoiStatsRow[]).map((r) => [r.place_id, r]));
}

/** Selection rate by shortlist-rank bucket. Fails soft to empty. */
export async function fetchRankBucketStats(): Promise<RankBucketRow[]> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("admin_rank_bucket_stats");
  if (error) {
    logger.warn("[poi-analytics] admin_rank_bucket_stats failed", { error: error.message });
    return [];
  }
  return (data ?? []) as RankBucketRow[];
}

/** Latest decayed trend score per place across all destinations. */
export async function fetchTrendScores(): Promise<Map<string, number>> {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - TREND_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("poi_trending_signals")
    .select("place_id, poi_name, platforms, reason, raw_score, collected_at")
    .gte("collected_at", cutoff);
  if (error) {
    logger.warn("[poi-analytics] trend score fetch failed", { error: error.message });
    return new Map();
  }
  const now = new Date();
  const scores = new Map<string, number>();
  for (const row of data ?? []) {
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
    const prev = scores.get(row.place_id) ?? 0;
    if (score > prev) scores.set(row.place_id, score);
  }
  return scores;
}

// ─── Corpus overview (pure) ───────────────────────────────────────────────────

export interface GroupRollup {
  key: string;
  pois: number;
  exposures: number;
  selections: number;
  /** null when the group never appeared in a shortlist. */
  selectionRate: number | null;
}

export interface RankedPoi {
  placeId: string;
  name: string;
  destination: string;
  category: string | null;
  exposures: number;
  selectionRate: number;
  trendScore: number;
}

export interface CorpusOverview {
  totalPois: number;
  uncategorized: number;
  byStatus: GroupRollup[];
  byCategory: GroupRollup[];
  bySource: GroupRollup[];
  byDestination: GroupRollup[];
  /** Exposure-weighted mean similarity of selected vs rejected appearances. */
  similaritySplit: { selected: number | null; rejected: number | null };
  /** ≥ MIN_EXPOSURES appearances, best selection rate first. */
  topPerformers: RankedPoi[];
  /** ≥ MIN_EXPOSURES appearances, worst selection rate first — demotion candidates. */
  underperformers: RankedPoi[];
  /** Live trend score but zero shortlist exposure — retrieval is missing them. */
  trendingUnexposed: RankedPoi[];
}

export const MIN_EXPOSURES = 5;

export function buildCorpusOverview(
  pois: CorpusPoiRow[],
  stats: Map<string, PoiStatsRow>,
  trendScores: Map<string, number>
): CorpusOverview {
  const rollup = (keyOf: (p: CorpusPoiRow) => string): GroupRollup[] => {
    const groups = new Map<string, { pois: number; exposures: number; selections: number }>();
    for (const p of pois) {
      const key = keyOf(p);
      const g = groups.get(key) ?? { pois: 0, exposures: 0, selections: 0 };
      g.pois += 1;
      const s = stats.get(p.place_id);
      if (s) {
        g.exposures += s.exposures;
        g.selections += s.selections;
      }
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([key, g]) => ({
        key,
        ...g,
        selectionRate: g.exposures > 0 ? g.selections / g.exposures : null,
      }))
      .sort((a, b) => b.exposures - a.exposures || b.pois - a.pois);
  };

  // Exposure-weighted similarity split across the corpus.
  let selSimSum = 0;
  let selCount = 0;
  let rejSimSum = 0;
  let rejCount = 0;
  for (const s of stats.values()) {
    if (s.avg_similarity_selected != null && s.selections > 0) {
      selSimSum += s.avg_similarity_selected * s.selections;
      selCount += s.selections;
    }
    const rejections = s.exposures - s.selections;
    if (s.avg_similarity_rejected != null && rejections > 0) {
      rejSimSum += s.avg_similarity_rejected * rejections;
      rejCount += rejections;
    }
  }

  const ranked: RankedPoi[] = pois
    .map((p) => {
      const s = stats.get(p.place_id);
      return {
        placeId: p.place_id,
        name: p.name,
        destination: p.destination_name,
        category: p.category,
        exposures: s?.exposures ?? 0,
        selectionRate: s ? s.selection_rate : 0,
        trendScore: trendScores.get(p.place_id) ?? 0,
      };
    });

  const withSignal = ranked.filter((r) => r.exposures >= MIN_EXPOSURES);

  return {
    totalPois: pois.length,
    uncategorized: pois.filter((p) => p.category == null).length,
    byStatus: rollup((p) => p.curation_status),
    byCategory: rollup((p) => p.category ?? "(uncategorized)"),
    bySource: rollup((p) => p.source),
    byDestination: rollup((p) => p.destination_name),
    similaritySplit: {
      selected: selCount > 0 ? selSimSum / selCount : null,
      rejected: rejCount > 0 ? rejSimSum / rejCount : null,
    },
    topPerformers: [...withSignal].sort((a, b) => b.selectionRate - a.selectionRate).slice(0, 10),
    underperformers: [...withSignal].sort((a, b) => a.selectionRate - b.selectionRate).slice(0, 10),
    trendingUnexposed: ranked
      .filter((r) => r.trendScore > 0 && r.exposures === 0)
      .sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, 10),
  };
}
