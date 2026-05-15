-- Calendar bento grid: per-user availability marks (Doodle-style),
-- per-user calendar tile settings (which countries' holidays to show),
-- and a Nager.Date public-holidays cache table.

-- ─── availability_status enum ─────────────────────────────────────────────────

create type availability_status as enum ('free', 'maybe', 'busy');

-- ─── trip_availability ────────────────────────────────────────────────────────
-- One row per (trip, user, date). The composite primary key gives us natural
-- upsert + "one mark per day per user". Works for both LINE-group trips and
-- group-less trips (no group_id stored — auth happens at the route layer).
create table trip_availability (
  trip_id        uuid not null references trips (id) on delete cascade,
  line_user_id   text not null,
  date           date not null,
  status         availability_status not null,
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (trip_id, line_user_id, date)
);

create index trip_availability_trip_date_idx on trip_availability (trip_id, date);

alter table trip_availability enable row level security;
create policy "no anon access" on trip_availability for all to anon using (false);

-- ─── trip_calendar_settings ───────────────────────────────────────────────────
-- Per-(trip, user) tile preferences. country_codes is the set of ISO-3166-1
-- alpha-2 codes whose national holidays should render in the calendar grid.
create table trip_calendar_settings (
  trip_id        uuid not null references trips (id) on delete cascade,
  line_user_id   text not null,
  country_codes  text[] not null default '{}',
  updated_at     timestamptz not null default now(),
  primary key (trip_id, line_user_id)
);

alter table trip_calendar_settings enable row level security;
create policy "no anon access" on trip_calendar_settings for all to anon using (false);

-- ─── national_holidays_cache ──────────────────────────────────────────────────
-- Server-side cache of Nager.Date public holidays so we don't hit their API
-- on every render. Refreshed on a TTL (see lib/holidays.ts).
create table national_holidays_cache (
  country_code   text not null,                -- ISO-3166-1 alpha-2, e.g. 'TW'
  year           int  not null,
  date           date not null,
  name           text not null,                -- localized name from Nager (localName)
  global         boolean not null default true,
  fetched_at     timestamptz not null default now(),
  primary key (country_code, year, date)
);

create index national_holidays_cache_country_year_idx
  on national_holidays_cache (country_code, year);

alter table national_holidays_cache enable row level security;
create policy "no anon access" on national_holidays_cache for all to anon using (false);
