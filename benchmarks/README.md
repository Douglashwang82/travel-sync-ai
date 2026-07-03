# Itinerary benchmarks

Quality tracking for the trip-generation pipeline (`services/trip-generation/`).

- **Scorer** — `services/trip-generation/benchmark.ts`. Deterministic, no LLM:
  seven weighted metrics (coverage, pace_fit, meal_coverage, travel_efficiency,
  diversity, vibe_alignment, must_haves) aggregated to a 0–100 total.
- **Offline gate** — `__tests__/evals/itinerary.eval.test.ts` scores the golden
  and flawed fixtures under `__tests__/evals/fixtures/itinerary/` on every
  `npm test`. Golden fixtures assert a score floor; flawed fixtures assert a
  ceiling, so the scorer can't silently go soft.
- **Live runs** — `npm run benchmark:itinerary` executes the real pipeline for
  each scenario in `scenarios.json` (real Gemini calls, persists private
  templates authored by `benchmark-runner`), scores the persisted result, and
  appends one JSON row per scenario to `history.jsonl`.

## Tracking improvement over time

Run `npm run benchmark:itinerary` after generator changes (prompt tweaks,
solver tunables, reranker training, corpus updates) and compare against the
tail of `history.jsonl` — each row carries the git rev, per-metric scores and
elapsed time. Commit `history.jsonl` when a row is worth keeping as a
reference point.

Add scenarios by appending to `scenarios.json` (validated by the Zod schema in
`scripts/benchmark-itinerary.ts`). Use destinations that exist in the
`poi_embeddings` corpus, otherwise generation fails with `no_candidates`.
