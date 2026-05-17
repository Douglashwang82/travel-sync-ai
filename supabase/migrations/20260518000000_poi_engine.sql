-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — POI Engine (vector + live data)
-- Migration: 20260518000000_poi_engine
--
-- Backs the v1.2 itinerary generator's POI tier:
--   • poi_embeddings    — pgvector store for "vibe-based" candidate retrieval
--   • place_details_cache — short-TTL cache for Google Places live data
--                          (opening hours, rating, price level, lat/lng)
--
-- See design/trip-generation.md and the orchestrator under
-- services/trip-generation/.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists vector;

-- ─── poi_embeddings ──────────────────────────────────────────────────────────
-- Cold-started by scripts/seed-poi-embeddings.ts; warm-grown by the orchestrator
-- whenever a generation surfaces a new place.
--
-- 768 dims = Gemini text-embedding-004 output.
create table poi_embeddings (
  place_id           text primary key,
  destination_name   text not null,
  name               text not null,
  item_type          text not null check (item_type in ('hotel','restaurant','activity','transport','other')),
  tags               text[] not null default '{}',
  description        text not null,
  embedding          vector(768) not null,
  lat                double precision,
  lng                double precision,
  source             text not null default 'google_places',
  last_seen_at       timestamptz not null default now()
);

-- Hard SQL-level destination filter must precede ANN search; nothing pollutes
-- a Kyoto query with Tokyo cafés.
create index poi_embeddings_destination_idx
  on poi_embeddings (lower(destination_name));

create index poi_embeddings_item_type_idx
  on poi_embeddings (item_type);

-- HNSW: small dataset, query-heavy, no training step. Cosine matches
-- text-embedding-004's training objective.
create index poi_embeddings_embedding_idx
  on poi_embeddings using hnsw (embedding vector_cosine_ops);

-- ─── search_pois_by_vibe RPC ─────────────────────────────────────────────────
-- Called by services/trip-generation/poi-engine.ts. Returning the similarity
-- score lets the orchestrator drop weak matches when results are sparse.
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
  where lower(p.destination_name) = lower(p_destination)
    and (p_item_types is null or p.item_type = any(p_item_types))
  order by p.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ─── place_details_cache ─────────────────────────────────────────────────────
-- Google Places details are ~$17/1000 calls; opening hours rarely change.
-- 7-day TTL is enforced in code via fetched_at, not by deletion — we keep
-- stale rows so a quota-exhausted run can still serve degraded data.
create table place_details_cache (
  place_id     text primary key,
  payload      jsonb not null,
  fetched_at   timestamptz not null default now()
);

create index place_details_cache_fetched_at_idx
  on place_details_cache (fetched_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table poi_embeddings       enable row level security;
alter table place_details_cache  enable row level security;

create policy "no anon access" on poi_embeddings       for all to anon using (false);
create policy "no anon access" on place_details_cache  for all to anon using (false);
