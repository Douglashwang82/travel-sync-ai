-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — User Saved POIs ("My Places")
-- Migration: 20260529000000_user_saved_pois
-- ─────────────────────────────────────────────────────────────────────────────
-- A private, per-user bookmark list of points-of-interest, NOT tied to any trip.
-- Users build it from the map explorer (/app/map) by saving curated POIs, route
-- stops, or live Google Places results, and manage it on /app/pois.
--
-- Ownership is by LINE user (mirrors personal_packing_items). RLS denies anon
-- access entirely — the server-side admin client is the only reader/writer and
-- enforces ownership via `line_user_id` filters at the API layer.

create table user_saved_pois (
  id                uuid primary key default gen_random_uuid(),
  line_user_id      text not null,
  -- Google / curated corpus place id. Null for free-form manual entries.
  place_id          text,
  name              text not null,
  -- hotel | restaurant | activity | transport | other
  item_type         text not null default 'activity',
  address           text,
  lat               double precision not null,
  lng               double precision not null,
  notes             text,
  -- where it came from: curated | google | manual | explorer
  source            text not null default 'manual',
  -- optional context: the destination the place was discovered under
  destination_name  text,
  google_maps_url   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index user_saved_pois_owner_idx
  on user_saved_pois (line_user_id, created_at desc);

-- A user can't save the same identifiable place twice. Manual rows (null
-- place_id) are exempt — a partial unique index skips them.
create unique index user_saved_pois_owner_place_uniq
  on user_saved_pois (line_user_id, place_id)
  where place_id is not null;

create trigger user_saved_pois_set_updated_at
  before update on user_saved_pois
  for each row execute function update_updated_at_column();

alter table user_saved_pois enable row level security;
create policy "no anon access" on user_saved_pois
  for all to anon using (false);
