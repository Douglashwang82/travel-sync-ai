-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Source tags for generator picks
-- Migration: 20260530000000_trip_template_items_source_tag
--
-- Adds source_tag to trip_template_items so the generator can record where
-- each picked POI came from (e.g. 'google_places', 'curated', 'admin_upload',
-- 'google_places_live').
--
-- Also updates both vector-search RPCs to surface the source column so the
-- poi-engine and route-engine TypeScript layers can carry provenance through
-- the full pipeline without a separate DB round-trip.
-- ─────────────────────────────────────────────────────────────────────────────

alter table trip_template_items
  add column if not exists source_tag text;

-- ─── search_pois_by_vibe — add source to return set ─────────────────────────
drop function if exists search_pois_by_vibe(text, vector, text[], integer);

create function search_pois_by_vibe(
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
  live_data    jsonb,
  source       text,
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
    p.live_data,
    p.source,
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

-- ─── search_routes_by_vibe — add source to return set ───────────────────────
drop function if exists search_routes_by_vibe(text, vector, text, integer);

create function search_routes_by_vibe(
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
  source              text,
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
    r.source,
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
