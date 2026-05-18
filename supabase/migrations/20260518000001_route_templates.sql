-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Route Templates (curated 1-day routes)
-- Migration: 20260518000001_route_templates
--
-- Sits above the POI corpus: a curated "vibe → ordered day plan" layer queried
-- by the orchestrator before falling back to per-POI LLM picking.
--
--   • Routes reference poi_embeddings.place_id; no parallel POI store.
--   • Promotion levers (boost, quality_score, pinned_vibes, is_archived) are
--     mutable knobs the admin / quality cron can dial without re-embedding.
--   • Health bookkeeping is updated lazily by the route-engine at retrieval
--     time when it spots dead place_ids.
--
-- See design/trip-generation.md and services/trip-generation/route-engine.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── route_templates ─────────────────────────────────────────────────────────
create table route_templates (
  id                   uuid primary key default gen_random_uuid(),
  destination_name     text not null,
  title                text not null,
  summary              text not null,
  vibe_tags            text[] not null default '{}',
  pace                 text not null check (pace in ('chill','balanced','packed')),
  place_ids            text[] not null check (array_length(place_ids, 1) between 1 and 8),
  embedding            vector(768) not null,

  -- Promotion levers
  boost                numeric not null default 0,
  quality_score        numeric not null default 0,
  pinned_vibes         text[] not null default '{}',
  is_archived          boolean not null default false,

  -- Lazy health bookkeeping
  last_health_ok_at    timestamptz,
  last_health_fail_at  timestamptz,

  source               text not null default 'curated',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index route_templates_destination_title_uniq
  on route_templates (lower(destination_name), lower(title));

create index route_templates_destination_idx
  on route_templates (lower(destination_name))
  where is_archived = false;

create index route_templates_pace_idx
  on route_templates (pace)
  where is_archived = false;

create index route_templates_embedding_idx
  on route_templates using hnsw (embedding vector_cosine_ops);

-- ─── search_routes_by_vibe RPC ───────────────────────────────────────────────
-- Mirrors search_pois_by_vibe. Returns raw similarity; the route-engine layers
-- boost / quality_score / pin bonuses on top in TypeScript so the weights stay
-- tunable without a migration.
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
    and lower(r.destination_name) = lower(p_destination)
    and (p_pace is null or r.pace = p_pace)
  order by r.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ─── bump_route_quality RPC ──────────────────────────────────────────────────
-- Called by the orchestrator after a successful generation to accumulate a
-- usage signal on routes that contributed to the trip. Atomic increment
-- avoids the read-modify-write race the PostgREST table API would create.
create or replace function bump_route_quality(
  p_route_ids uuid[],
  p_delta     numeric default 1
) returns void language sql as $$
  update route_templates
     set quality_score = quality_score + p_delta
   where id = any(p_route_ids);
$$;

-- ─── updated_at trigger ──────────────────────────────────────────────────────
create or replace function route_templates_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger route_templates_touch_updated_at
  before update on route_templates
  for each row execute function route_templates_touch_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table route_templates enable row level security;
create policy "no anon access" on route_templates for all to anon using (false);
