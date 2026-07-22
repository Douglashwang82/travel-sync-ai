-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — POI curation & ranking analytics
-- Migration: 20260707000000_poi_curation
--
-- Backs the admin POI management console (/admin/pois): human curation
-- columns on poi_embeddings and the aggregate RPCs the ranking-analytics
-- dashboard reads. Curation is actionable, not decorative:
--   • curation_status = 'hidden' removes a POI from vibe retrieval (the RPC
--     below) and from the index-page trending wall;
--   • category / labels / quality_score are features a future ranking
--     algorithm can consume, alongside the itinerary_feedback aggregates.
-- ─────────────────────────────────────────────────────────────────────────────

alter table poi_embeddings
  add column if not exists category text
    check (category in ('landmark','culture','nature','food','museum','nightlife','shopping','wellness','other')),
  -- Free-form curation labels. Distinct from `tags` (which feed the embedding
  -- description and vibe matching): labels never trigger re-embedding.
  add column if not exists labels text[] not null default '{}',
  add column if not exists curation_status text not null default 'unreviewed'
    check (curation_status in ('unreviewed','approved','hidden')),
  -- Manual quality prior in [0,1]; null = unrated.
  add column if not exists quality_score numeric
    check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  add column if not exists curation_notes text,
  add column if not exists curated_at timestamptz;

create index if not exists poi_embeddings_category_idx on poi_embeddings (category);
create index if not exists poi_embeddings_curation_status_idx on poi_embeddings (curation_status);

-- ─── search_pois_by_vibe — hidden POIs never reach the generator ─────────────
-- Drop-then-create (same pattern as 20260526000001): the deployed function's
-- recorded return type can drift from the repo definition, and CREATE OR
-- REPLACE refuses any return-type change.
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
    1 - (p.embedding <=> p_query_embedding) as similarity
  from poi_embeddings p
  where (
      lower(p.destination_name) = lower(trim(p_destination))
      or lower(trim(p_destination)) = any(p.destination_aliases)
    )
    and (p_item_types is null or p.item_type = any(p_item_types))
    and p.curation_status <> 'hidden'
  order by p.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ─── admin_poi_stats — per-POI ranking-signal aggregates ─────────────────────
-- One row per place_id that ever appeared in a generation shortlist:
-- exposure, selection rate, average vector rank/similarity, plus the
-- similarity split between selected and rejected appearances (the single most
-- informative number for judging whether cosine similarity predicts picks).
create or replace function admin_poi_stats(p_destination text default null)
returns table (
  place_id                text,
  exposures               bigint,
  selections              bigint,
  selection_rate          float,
  avg_shortlist_rank      float,
  avg_similarity          float,
  avg_similarity_selected float,
  avg_similarity_rejected float,
  last_exposure_at        timestamptz
) language sql stable as $$
  select
    f.place_id,
    count(*)                                                        as exposures,
    count(*) filter (where f.was_selected)                          as selections,
    (count(*) filter (where f.was_selected))::float / count(*)      as selection_rate,
    avg(f.shortlist_rank)::float                                    as avg_shortlist_rank,
    avg(f.similarity)::float                                        as avg_similarity,
    avg(f.similarity) filter (where f.was_selected)::float          as avg_similarity_selected,
    avg(f.similarity) filter (where not f.was_selected)::float      as avg_similarity_rejected,
    max(f.created_at)                                               as last_exposure_at
  from itinerary_feedback f
  where p_destination is null or exists (
    select 1 from poi_embeddings p
    where p.place_id = f.place_id
      and (
        lower(p.destination_name) = lower(trim(p_destination))
        or p.destination_name ilike '%' || trim(p_destination) || '%'
      )
  )
  group by f.place_id;
$$;

-- ─── admin_rank_bucket_stats — does shortlist rank predict selection? ────────
-- Selection rate per 5-wide shortlist_rank bucket (0-4, 5-9, …). A flat curve
-- means the LLM ignores retrieval order; a steep one means rank position is a
-- strong feature a ranking algorithm should exploit.
create or replace function admin_rank_bucket_stats()
returns table (
  bucket_start int,
  exposures    bigint,
  selections   bigint,
  selection_rate float
) language sql stable as $$
  select
    (f.shortlist_rank / 5) * 5                                  as bucket_start,
    count(*)                                                    as exposures,
    count(*) filter (where f.was_selected)                      as selections,
    (count(*) filter (where f.was_selected))::float / count(*)  as selection_rate
  from itinerary_feedback f
  group by 1
  order by 1;
$$;
