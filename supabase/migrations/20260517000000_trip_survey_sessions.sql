-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip Survey Sessions
-- Migration: 20260517000000_trip_survey_sessions
--
-- Backs the /plan command and the /app/trips/new web wizard. One row per
-- in-flight survey; on completion the generator writes a private
-- trip_template_version and stamps template_id here so the user can
-- fork from the preview bubble.
--
-- See design/trip-generation.md for the full flow.
-- ─────────────────────────────────────────────────────────────────────────────

create type trip_survey_status as enum (
  'in_progress',
  'generated',
  'forked',
  'abandoned',
  'expired'
);

create table trip_survey_sessions (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid references line_groups (id) on delete cascade,
  app_user_id           uuid references app_users (id) on delete cascade,
  started_by_user_id    text not null,
  status                trip_survey_status not null default 'in_progress',
  current_step          text not null default 'destination',
  answers               jsonb not null default '{}'::jsonb,
  template_id           uuid references trip_templates (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '30 minutes'),

  -- Exactly one of group_id / app_user_id must be set.
  constraint trip_survey_sessions_owner_check check (
    (group_id is not null and app_user_id is null) or
    (group_id is null     and app_user_id is not null)
  )
);

-- At most one in-progress survey per group at a time.
create unique index trip_survey_sessions_one_open_per_group_idx
  on trip_survey_sessions (group_id)
  where status = 'in_progress' and group_id is not null;

create index trip_survey_sessions_app_user_idx
  on trip_survey_sessions (app_user_id)
  where app_user_id is not null;

-- Sweeper index: expired in-progress rows.
create index trip_survey_sessions_expiry_idx
  on trip_survey_sessions (expires_at)
  where status = 'in_progress';

create trigger trip_survey_sessions_updated_at
  before update on trip_survey_sessions
  for each row execute function update_updated_at_column();
