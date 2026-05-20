-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Per-trip Orchestrator
-- Migration: 20260520000000_trip_orchestrator
--
-- One orchestrator per trip. An LLM tool-use loop with the same surface area
-- a human has across every bento grid (items, ideas, expenses, votes, pack,
-- custom grids, etc.). Each tool is gated by a per-tool autonomy dial,
-- mirroring the existing `agent_autonomy` semantics:
--
--   propose_only          — write a pending proposal; nothing committed
--   auto_apply_with_undo  — apply the change; keep a row that supports undo
--   auto_apply            — apply the change; no undo prompt
--
-- Hybrid trigger model:
--   - cron (`/api/cron/orchestrator`) is the heartbeat + recovery sweeper.
--   - `wakeOrchestrator(tripId, reason)` lowers `next_run_at = now()` and is
--     called from the event-processor and key mutation paths to nudge in
--     near-real-time.
--
-- `orchestrator_actions` is the audit + ghost-lane for the bento tile.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  create type orchestrator_trigger as enum (
    'cron',
    'event',
    'manual'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type orchestrator_action_status as enum (
    'pending',       -- proposal in ghost lane, not applied
    'applied',       -- applied with undo trail
    'auto_applied',  -- applied, no undo prompt
    'dismissed',     -- user dismissed a proposal
    'undone',        -- user undid an applied action
    'failed'         -- tool execution failed
  );
exception
  when duplicate_object then null;
end $$;

-- ─── trip_orchestrators ──────────────────────────────────────────────────────
create table if not exists trip_orchestrators (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null unique references trips (id) on delete cascade,
  enabled               boolean not null default true,
  system_goal           text,                              -- user-supplied directive
  tool_autonomy         jsonb not null default '{}'::jsonb, -- { "items.create": "auto_apply_with_undo", ... }
  schedule_minutes      integer not null default 360,       -- heartbeat (6h default)
  next_run_at           timestamptz,
  pending_reason        text,                                -- why a wake was queued
  pending_trigger       orchestrator_trigger,
  memory                jsonb not null default '{}'::jsonb,  -- long-running notes the LLM writes
  last_run_at           timestamptz,
  last_status           text,                                -- 'success' | 'failed' | 'skipped'
  last_error            text,
  last_summary          text,                                -- one-liner shown on the tile
  consecutive_failures  integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists trip_orchestrators_due_idx
  on trip_orchestrators (enabled, next_run_at)
  where enabled = true;

drop trigger if exists trip_orchestrators_updated_at on trip_orchestrators;
create trigger trip_orchestrators_updated_at
  before update on trip_orchestrators
  for each row execute function update_updated_at_column();

alter table trip_orchestrators enable row level security;
do $$
begin
  create policy "no anon access" on trip_orchestrators for all to anon using (false);
exception
  when duplicate_object then null;
end $$;

-- ─── orchestrator_runs ───────────────────────────────────────────────────────
create table if not exists orchestrator_runs (
  id              uuid primary key default gen_random_uuid(),
  orchestrator_id uuid not null references trip_orchestrators (id) on delete cascade,
  trigger         orchestrator_trigger not null,
  trigger_reason  text,
  status          text not null default 'running',
  summary         text,
  transcript      jsonb,
  error           text,
  tool_call_count integer not null default 0,
  applied_count   integer not null default 0,
  proposed_count  integer not null default 0,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer
);

create index if not exists orchestrator_runs_orch_started_idx
  on orchestrator_runs (orchestrator_id, started_at desc);

alter table orchestrator_runs enable row level security;
do $$
begin
  create policy "no anon access" on orchestrator_runs for all to anon using (false);
exception
  when duplicate_object then null;
end $$;

-- ─── orchestrator_actions ────────────────────────────────────────────────────
-- One row per tool invocation. Doubles as the ghost lane (status='pending'),
-- the applied-action audit log (status='applied'|'auto_applied') and the
-- failure log (status='failed').
--
-- `target` carries enough information to render an undo button and to
-- actually reverse the change: { table, id, op, before }.
create table if not exists orchestrator_actions (
  id              uuid primary key default gen_random_uuid(),
  orchestrator_id uuid not null references trip_orchestrators (id) on delete cascade,
  run_id          uuid references orchestrator_runs (id) on delete set null,
  trip_id         uuid not null references trips (id) on delete cascade,
  tool            text not null,
  input           jsonb not null,
  result          jsonb,
  rationale       text,
  status          orchestrator_action_status not null,
  autonomy        agent_autonomy not null,
  target          jsonb,
  decided_by      uuid references app_users (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists orchestrator_actions_trip_status_idx
  on orchestrator_actions (trip_id, status, created_at desc);
create index if not exists orchestrator_actions_orch_idx
  on orchestrator_actions (orchestrator_id, created_at desc);

alter table orchestrator_actions enable row level security;
do $$
begin
  create policy "no anon access" on orchestrator_actions for all to anon using (false);
exception
  when duplicate_object then null;
end $$;
