-- Feedback signal for the POI re-ranker training pipeline.
--
-- Each row records one candidate from the vibe-search shortlist (K=30) and
-- whether the LLM pick assignment ultimately selected it for the itinerary.
--
-- Training features:  vibe_query TEXT → Gemini embedding (768-dim)
--                   + poi_embeddings.embedding (768-dim, looked up by place_id)
--                   ➜ concatenated 2304-dim feature vector
-- Label:             was_selected BOOLEAN (1 = positive, 0 = negative)
--
-- The vibe_query is stored as text rather than a pre-computed vector so we
-- can re-embed with a different model at training time without back-filling.
-- Unique vibe queries are typically in the low hundreds — cheap to batch-embed.

CREATE TABLE IF NOT EXISTS itinerary_feedback (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Correlation with the generator run (genId from orchestrator.ts).
  generation_id   text        NOT NULL,
  -- Version created from this generation; SET NULL on template deletion.
  version_id      uuid        REFERENCES trip_template_versions(id) ON DELETE SET NULL,
  -- POI that appeared in the shortlist.
  place_id        text        NOT NULL,
  -- Deterministic query string built from survey answers; re-embedded at train time.
  vibe_query      text        NOT NULL,
  -- Survey context preserved for stratified analysis and per-segment fine-tuning.
  survey_budget   text,
  survey_pace     text,
  survey_vibes    text[]      NOT NULL DEFAULT '{}',
  -- 0-indexed rank in the original vector search (before re-ranking).
  shortlist_rank  int         NOT NULL,
  -- Cosine similarity returned by pgvector — baseline feature for comparison.
  similarity      float4      NOT NULL,
  -- Label: true when the LLM picked this POI for at least one day.
  was_selected    boolean     NOT NULL,
  -- Day number when was_selected is true; null for rejected candidates.
  selected_day    int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Training data export: scan by recency, filter by label
CREATE INDEX ON itinerary_feedback (was_selected, created_at DESC);
-- POI-level analysis: how often is a given place selected?
CREATE INDEX ON itinerary_feedback (place_id);
-- Trace per generation run
CREATE INDEX ON itinerary_feedback (generation_id);
-- Join to template for labeling accuracy
CREATE INDEX ON itinerary_feedback (version_id) WHERE version_id IS NOT NULL;
