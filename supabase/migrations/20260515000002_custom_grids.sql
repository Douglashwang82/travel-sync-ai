-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Custom Bento Grids + AI Agents
-- Migration: 20260515000002_custom_grids
--
-- Lets a trip member add a custom bento tile backed by a "predefined agent".
-- Each grid stores: the agent type (registry key), per-grid config (JSON
-- validated by the agent's schema), and the most recent run's output.
--
-- Output is denormalized onto `custom_grids` (last_output / last_run_at /
-- last_status) so the UI can render the latest result in one query. Full
-- run history is in `custom_grid_runs` for observability and historical
-- charts (e.g. price-over-time).
--
-- Cron model mirrors `tracking_lists`: each row has `frequency_hours` and
-- `next_run_at`; a cron at /api/cron/agent-grids picks up due rows.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  create type custom_grid_run_status as enum (
    'pending',
    'running',
    'success',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

-- ─── custom_grids ────────────────────────────────────────────────────────────
create table if not exists custom_grids (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references trips (id) on delete cascade,
  created_by         uuid not null references app_users (id) on delete cascade,
  agent_type         text not null,                           -- registry key, e.g. 'flight_price_tracker'
  title              text not null,                           -- user-supplied display title
  config             jsonb not null default '{}'::jsonb,      -- agent-specific config (validated by agent.configSchema)
  is_active          boolean not null default true,
  frequency_hours    integer not null default 24,
  next_run_at        timestamptz,
  last_run_at        timestamptz,
  last_status        custom_grid_run_status,
  last_output        jsonb,                                   -- denormalized latest run output for fast render
  last_error         text,
  consecutive_failures integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists custom_grids_trip_idx on custom_grids (trip_id);
create index if not exists custom_grids_due_idx on custom_grids (is_active, next_run_at)
  where is_active = true;

drop trigger if exists custom_grids_updated_at on custom_grids;
create trigger custom_grids_updated_at
  before update on custom_grids
  for each row execute function update_updated_at_column();

alter table custom_grids enable row level security;
do $$
begin
  create policy "no anon access" on custom_grids for all to anon using (false);
exception
  when duplicate_object then null;
end $$;

-- ─── custom_grid_runs ────────────────────────────────────────────────────────
-- Per-run history. We keep these for observability and to enable trend lines
-- (e.g. "flight price over the last 30 days").
create table if not exists custom_grid_runs (
  id                 uuid primary key default gen_random_uuid(),
  custom_grid_id     uuid not null references custom_grids (id) on delete cascade,
  status             custom_grid_run_status not null,
  output             jsonb,
  error              text,
  duration_ms        integer,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create index if not exists custom_grid_runs_grid_started_idx
  on custom_grid_runs (custom_grid_id, started_at desc);
