// ─────────────────────────────────────────────────────────────────────────────
// POI Re-ranker — lightweight MLP scorer trained on historical itinerary
// feedback. Re-ranks the vibe-search shortlist before it reaches the LLM so
// higher-quality candidates surface first and the LLM sees a better pool.
//
// Architecture (trained offline with scripts/train-reranker.py):
//   features = [queryEmb ‖ poiEmb ‖ hadamard(queryEmb, poiEmb)]  (3 × 768 = 2304 dims)
//   → Linear(2304 → hidden) → GELU → Linear(hidden → 1) → sigmoid
//
// Weights are loaded from models/poi-reranker-weights.json on first use.
// When the file is absent (cold start, dev), every function is a no-op
// pass-through — the pipeline behaves exactly as before.
//
// Training data is collected by recordFeedback(), which is called fire-and-
// forget after every successful generation.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PoiCandidate } from "./poi-engine";
import type { SurveyAnswers } from "./index";

// ─── Weight schema ───────────────────────────────────────────────────────────

interface RerankerWeights {
  architecture: "mlp_2layer";
  /** Must equal 3 × embedding_dim (3 × 768 = 2304). */
  input_dim: number;
  hidden_dim: number;
  /** Shape: (hidden_dim, input_dim) — same layout as PyTorch nn.Linear. */
  w1: number[][];
  b1: number[];
  /** Shape: (1, hidden_dim). */
  w2: number[][];
  b2: number[];
  trained_at: string;
  train_auc: number;
  val_auc: number;
  train_samples: number;
}

// ─── Lazy weight loading ─────────────────────────────────────────────────────

let _weights: RerankerWeights | null = null;
let _loadAttempted = false;

function loadWeights(): RerankerWeights | null {
  if (_loadAttempted) return _weights;
  _loadAttempted = true;
  const path = join(process.cwd(), "models", "poi-reranker-weights.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isValidWeights(raw)) {
      logger.error("[reranker] weights file has unexpected shape, disabling re-ranking");
      return null;
    }
    _weights = raw;
    logger.info("[reranker] weights loaded", {
      valAuc: raw.val_auc.toFixed(3),
      trainSamples: raw.train_samples,
      trainedAt: raw.trained_at,
    });
    return _weights;
  } catch (err) {
    logger.error("[reranker] failed to parse weights file", { error: String(err) });
    return null;
  }
}

function isValidWeights(v: unknown): v is RerankerWeights {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  return (
    w.architecture === "mlp_2layer" &&
    typeof w.input_dim === "number" &&
    typeof w.hidden_dim === "number" &&
    Array.isArray(w.w1) &&
    w.w1.length > 0 &&
    Array.isArray(w.b1) &&
    Array.isArray(w.w2) &&
    w.w2.length > 0 &&
    Array.isArray(w.b2)
  );
}

// ─── Inference ───────────────────────────────────────────────────────────────

function gelu(x: number): number {
  // PyTorch tanh approximation of GELU — matches the training activation.
  const c = 0.7978845608028654;
  return 0.5 * x * (1 + Math.tanh(c * (x + 0.044715 * x * x * x)));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function inferScore(w: RerankerWeights, queryEmb: number[], poiEmb: number[]): number {
  const dim = queryEmb.length; // 768

  // [queryEmb ‖ poiEmb ‖ element-wise product] → 2304-dim feature
  const features = new Float64Array(dim * 3);
  for (let i = 0; i < dim; i++) {
    features[i] = queryEmb[i];
    features[dim + i] = poiEmb[i];
    features[2 * dim + i] = queryEmb[i] * poiEmb[i];
  }

  // Layer 1: linear → GELU
  const hidden = new Float64Array(w.hidden_dim);
  for (let j = 0; j < w.hidden_dim; j++) {
    let dot = w.b1[j];
    const row = w.w1[j];
    for (let i = 0; i < row.length; i++) dot += row[i] * features[i];
    hidden[j] = gelu(dot);
  }

  // Layer 2: linear → sigmoid
  let logit = w.b2[0];
  const row2 = w.w2[0];
  for (let j = 0; j < row2.length; j++) logit += row2[j] * hidden[j];
  return sigmoid(logit);
}

// ─── Public: re-rank ─────────────────────────────────────────────────────────

/**
 * Re-ranks the vibe-search POI shortlist using the trained MLP scorer.
 *
 * Falls back to the original ordering (no-op) when:
 *   - no weights file exists (cold start)
 *   - queryEmbedding is null (embedding unavailable / cold corpus fallback)
 *   - the poi_embeddings DB lookup fails
 *
 * The returned candidates have their `similarity` field overwritten with the
 * model score so downstream logging reflects what the model saw.
 */
export async function rerankCandidates(
  queryEmbedding: number[] | null,
  pois: PoiCandidate[],
  genId?: string
): Promise<PoiCandidate[]> {
  const w = loadWeights();
  if (!w || !queryEmbedding || pois.length === 0) return pois;

  // Load stored embedding vectors for all shortlist candidates in one batch.
  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, embedding")
    .in(
      "place_id",
      pois.map((p) => p.placeId)
    );

  if (error) {
    logger.warn("[reranker] poi_embeddings lookup failed, skipping re-rank", {
      genId,
      error: String(error.message ?? error),
    });
    return pois;
  }

  // pgvector returns the vector column as a string "[f1,f2,...]" or as a
  // plain JS number[] depending on the PostgREST version; handle both.
  const embByPlaceId = new Map<string, number[]>(
    ((data ?? []) as Array<{ place_id: string; embedding: unknown }>).map((r) => {
      const emb =
        typeof r.embedding === "string"
          ? (JSON.parse(r.embedding) as number[])
          : (r.embedding as number[]);
      return [r.place_id, emb];
    })
  );

  const scored = pois.map((poi) => {
    const poiEmb = embByPlaceId.get(poi.placeId);
    // POIs without a stored embedding (live Google fallback) keep their
    // cosine similarity score so they still compete, just without re-ranking.
    if (!poiEmb) return { poi, score: poi.similarity };
    return { poi, score: inferScore(w, queryEmbedding, poiEmb) };
  });

  scored.sort((a, b) => b.score - a.score);

  logger.info("[reranker] re-ranked candidates", {
    genId,
    total: scored.length,
    embeddingHits: embByPlaceId.size,
    topScore: scored[0]?.score.toFixed(3),
    bottomScore: scored[scored.length - 1]?.score.toFixed(3),
  });

  return scored.map(({ poi, score }) => ({ ...poi, similarity: score }));
}

// ─── Public: record feedback ─────────────────────────────────────────────────

// Minimal shape matching PickResult from orchestrator.ts.
// Defined locally to avoid a circular module dependency (orchestrator → reranker → orchestrator).
interface LlmPickResult {
  days: Array<{ day_number: number; place_ids: string[] }>;
}

export interface FeedbackInput {
  genId: string;
  versionId: string;
  vibeQuery: string;
  /** Original vibe-search shortlist, in original rank order (before re-ranking). */
  poiCandidates: PoiCandidate[];
  /** LLM day-assignment result used to determine which candidates were selected. */
  pick: LlmPickResult;
  answers: SurveyAnswers;
}

/**
 * Persists one feedback row per shortlist candidate, recording whether the
 * LLM pick assignment selected it. Used as training data for the re-ranker.
 *
 * Callers should invoke this fire-and-forget with `.catch()` — a feedback
 * write failure must never surface to the user.
 */
export async function recordFeedback({
  genId,
  versionId,
  vibeQuery,
  poiCandidates,
  pick,
  answers,
}: FeedbackInput): Promise<void> {
  const selectedIds = new Set(pick.days.flatMap((d) => d.place_ids));
  const dayByPlaceId = new Map<string, number>();
  for (const d of pick.days) {
    for (const id of d.place_ids) dayByPlaceId.set(id, d.day_number);
  }

  const rows = poiCandidates.map((poi, rank) => ({
    generation_id: genId,
    version_id: versionId,
    place_id: poi.placeId,
    vibe_query: vibeQuery,
    survey_budget: answers.budget_tier ?? null,
    survey_pace: answers.pace ?? null,
    survey_vibes: answers.vibe ?? [],
    shortlist_rank: rank,
    similarity: poi.similarity,
    was_selected: selectedIds.has(poi.placeId),
    selected_day: dayByPlaceId.get(poi.placeId) ?? null,
  }));

  const db = createAdminClient();
  const { error } = await db.from("itinerary_feedback").insert(rows);
  if (error) throw new Error(`itinerary_feedback insert failed: ${error.message}`);

  logger.info("[reranker] feedback recorded", {
    genId,
    total: rows.length,
    selected: rows.filter((r) => r.was_selected).length,
  });
}
