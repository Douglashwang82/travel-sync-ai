-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Curated live data on poi_embeddings
-- Migration: 20260518000002_poi_embeddings_live_data
--
-- Adds an optional jsonb column to poi_embeddings so curated POIs (e.g.,
-- ski resorts ingested from data/japan-ski-trip/national/resorts.json)
-- can carry their own opening hours, address, etc. without faking entries
-- in place_details_cache.
--
-- enrichWithLiveData() in services/trip-generation/poi-engine.ts prefers
-- this column when present and only falls back to the Google Places cache
-- for rows whose live_data is null. The solver reads openingPeriods from
-- whichever source provides them.
-- ─────────────────────────────────────────────────────────────────────────────

alter table poi_embeddings
  add column if not exists live_data jsonb;

comment on column poi_embeddings.live_data is
  'Optional PlaceLiveData (placeId, name, address, lat, lng, openingPeriods). '
  'Populated for curated rows that do not have a Google place_id. '
  'When non-null, enrichWithLiveData uses this instead of the Google cache.';
