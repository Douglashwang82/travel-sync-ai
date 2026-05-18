-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Destination aliases for cross-destination matching
-- Migration: 20260518000003_destination_aliases
--
-- The orchestrator's current `destination_name = $1` exact-match misses
-- common variants: a survey answer of "Hokkaido" doesn't match rows stored
-- as "Hokkaido, Japan"; a query like "japan ski trip" matches nothing at
-- all. This migration adds a `destination_aliases text[]` column to both
-- poi_embeddings and route_templates, and updates the vibe-search RPCs to
-- match against either the canonical destination_name OR any alias.
--
-- Convention: aliases are stored lowercased; the RPCs lowercase the query
-- so the comparison is case-insensitive.
-- ─────────────────────────────────────────────────────────────────────────────

alter table poi_embeddings
  add column if not exists destination_aliases text[] not null default '{}';
alter table route_templates
  add column if not exists destination_aliases text[] not null default '{}';

-- GIN indexes only help when the table is large — keep small for now to avoid
-- write amplification. Add them if profiling shows the OR-clause is slow:
--   create index poi_embeddings_destination_aliases_idx
--     on poi_embeddings using gin (destination_aliases);
--   create index route_templates_destination_aliases_idx
--     on route_templates using gin (destination_aliases) where is_archived = false;

-- ─── search_pois_by_vibe — alias-aware ───────────────────────────────────────
create or replace function search_pois_by_vibe(
  p_destination       text,
  p_query_embedding   vector(768),
  p_item_types        text[] default null,
  p_limit             int default 30
) returns table (
  place_id     text,
  name         text,
  item_type    text,
  tags         text[],
  description  text,
  lat          double precision,
  lng          double precision,
  similarity   float
) language sql stable as $$
  select
    p.place_id,
    p.name,
    p.item_type,
    p.tags,
    p.description,
    p.lat,
    p.lng,
    1 - (p.embedding <=> p_query_embedding) as similarity
  from poi_embeddings p
  where (
      lower(p.destination_name) = lower(trim(p_destination))
      or lower(trim(p_destination)) = any(p.destination_aliases)
    )
    and (p_item_types is null or p.item_type = any(p_item_types))
  order by p.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ─── search_routes_by_vibe — alias-aware ─────────────────────────────────────
create or replace function search_routes_by_vibe(
  p_destination       text,
  p_query_embedding   vector(768),
  p_pace              text default null,
  p_limit             int default 10
) returns table (
  id                  uuid,
  title               text,
  summary             text,
  vibe_tags           text[],
  pace                text,
  place_ids           text[],
  boost               numeric,
  quality_score       numeric,
  pinned_vibes        text[],
  similarity          float
) language sql stable as $$
  select
    r.id,
    r.title,
    r.summary,
    r.vibe_tags,
    r.pace,
    r.place_ids,
    r.boost,
    r.quality_score,
    r.pinned_vibes,
    1 - (r.embedding <=> p_query_embedding) as similarity
  from route_templates r
  where r.is_archived = false
    and (
      lower(r.destination_name) = lower(trim(p_destination))
      or lower(trim(p_destination)) = any(r.destination_aliases)
    )
    and (p_pace is null or r.pace = p_pace)
  order by r.embedding <=> p_query_embedding
  limit p_limit;
$$;
