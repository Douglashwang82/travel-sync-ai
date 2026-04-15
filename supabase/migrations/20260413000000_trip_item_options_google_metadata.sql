-- Add structured Google place metadata to trip_item_options.
--
-- Rationale:
-- v1.2 now enriches confirmed Google-backed options after vote close. Storing
-- the most useful map metadata in first-class columns makes itinerary, ops,
-- and future route/weather integrations easier to query and render.
--
-- This migration is intentionally additive and non-destructive. Existing rows
-- continue to work as-is, and metadata_json remains available for overflow and
-- provider-specific payloads.

alter table public.trip_item_options
  add column if not exists lat double precision;

alter table public.trip_item_options
  add column if not exists lng double precision;

alter table public.trip_item_options
  add column if not exists google_maps_url text;

alter table public.trip_item_options
  add column if not exists photo_name text;

alter table public.trip_item_options
  add column if not exists source_last_synced_at timestamptz;

create index if not exists trip_item_options_provider_external_ref_idx
  on public.trip_item_options (provider, external_ref)
  where external_ref is not null;

create index if not exists trip_item_options_lat_lng_idx
  on public.trip_item_options (lat, lng)
  where lat is not null and lng is not null;
