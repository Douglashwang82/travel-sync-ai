-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — LLM call telemetry
-- Migration: 20260523000000_llm_calls
--
-- Records every Gemini / Anthropic API call from the server. Used for:
--   - cost dashboards (sum cost_usd by day / model / prompt_id)
--   - replay tooling (re-run an orchestrator turn against a new prompt
--     version and diff tool calls)
--   - regression analysis (which prompt version broke parse accuracy?)
--
-- Written from lib/llm.ts via recordLlmCall(). Best-effort: a failed insert
-- here must not block the calling code (the wrapper swallows write errors
-- after a single retry).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists llm_calls (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,                 -- 'gemini' | 'anthropic'
  model           text not null,                 -- e.g. 'gemini-2.5-flash', 'claude-opus-4-7'
  task_class      text,                          -- 'orchestrator' | 'parsing' | 'private_chat' | 'agent_summary' | ...
  prompt_id       text,                          -- nullable; populated when the call uses a registry prompt
  prompt_hash     text,                          -- sha256 of the resolved system prompt content
  tokens_in       integer,
  tokens_out      integer,
  cost_usd        numeric(12, 6),                -- best-effort, per provider price table in lib/llm-pricing.ts
  latency_ms      integer,
  status          text not null,                 -- 'ok' | 'error' | 'circuit_open'
  error           text,
  trip_id         uuid references trips (id) on delete set null,
  orchestrator_run_id uuid references orchestrator_runs (id) on delete set null,
  metadata        jsonb,                         -- { turn, schema_id, ... } free-form for now
  created_at      timestamptz not null default now()
);

create index if not exists llm_calls_created_at_idx
  on llm_calls (created_at desc);

create index if not exists llm_calls_task_class_created_at_idx
  on llm_calls (task_class, created_at desc);

create index if not exists llm_calls_orchestrator_run_idx
  on llm_calls (orchestrator_run_id)
  where orchestrator_run_id is not null;

create index if not exists llm_calls_prompt_id_idx
  on llm_calls (prompt_id, created_at desc)
  where prompt_id is not null;

alter table llm_calls enable row level security;
do $$
begin
  create policy "no anon access" on llm_calls for all to anon using (false);
exception
  when duplicate_object then null;
end $$;
