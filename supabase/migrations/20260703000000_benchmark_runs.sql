-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Itinerary benchmark runs
-- Migration: 20260703000000_benchmark_runs
-- ─────────────────────────────────────────────────────────────────────────────
-- Persistent history for the itinerary quality benchmark
-- (services/trip-generation/benchmark.ts). One row per scored generation run,
-- written by both the CLI runner (scripts/benchmark-itinerary.ts) and the web
-- UI at /app/benchmark, so score trends survive across machines and deploys —
-- the local benchmarks/history.jsonl file remains a CLI convenience copy.
--
-- RLS denies anon access entirely — the server-side admin client is the only
-- reader/writer; the /api/app/benchmark routes gate on a signed-in app user.

create table benchmark_runs (
  id              uuid primary key default gen_random_uuid(),
  ran_at          timestamptz not null default now(),
  -- 'cli' (scripts/benchmark-itinerary.ts) or 'web' (/app/benchmark)
  source          text not null default 'web' check (source in ('cli', 'web')),
  -- short git rev of the code that produced the run (null when unknown, e.g. Vercel)
  git_rev         text,
  -- preset id from benchmarks/scenarios.json, or 'adhoc' for one-off web runs
  scenario_id     text not null,
  -- the full survey answers the run was generated from
  answers         jsonb not null,
  start_date      date,
  ok              boolean not null,
  -- GenerationFailedError reason when ok = false
  failure_reason  text,
  -- deterministic aggregate 0–100 (null when the run failed)
  total           numeric,
  -- per-metric 0–1 scores keyed by metric id
  metrics         jsonb,
  stats           jsonb,
  -- LLM-as-judge verdict { pass, score, aspects, reasoning } (null when skipped)
  judge           jsonb,
  template_id     uuid,
  version_id      uuid,
  elapsed_ms      integer,
  -- line_user_id of the web user who triggered it; null for CLI runs
  triggered_by    text
);

create index benchmark_runs_scenario_idx
  on benchmark_runs (scenario_id, ran_at desc);

create index benchmark_runs_ran_at_idx
  on benchmark_runs (ran_at desc);

alter table benchmark_runs enable row level security;
create policy "no anon access" on benchmark_runs
  for all to anon using (false);
