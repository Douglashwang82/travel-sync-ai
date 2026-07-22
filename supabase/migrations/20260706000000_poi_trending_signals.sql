-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trending POI signals from social media
-- Migration: 20260706000000_poi_trending_signals
--
-- Backs services/trending/: a collector (cron + manual script) that uses
-- Gemini Google-Search grounding to find POIs currently trending on social
-- media (Instagram / TikTok / Reddit / YouTube / blogs) for a destination,
-- resolves them to Google place_ids, and records one signal row per
-- (destination, place). The itinerary generator's POI-picking phase reads
-- these rows and blends a recency-decayed trend score into the shortlist
-- ranking (see services/trending/signals.ts).
--
-- Newly discovered places are also upserted into poi_embeddings with
-- source = 'social_trending' so vector retrieval can surface them.
-- ─────────────────────────────────────────────────────────────────────────────

create table poi_trending_signals (
  id                 uuid primary key default gen_random_uuid(),
  -- Google place_id (or local:… for curated rows). Deliberately not a FK:
  -- the signal may arrive before/without a corpus row and must never block.
  place_id           text not null,
  -- Same normalization convention as poi_embeddings.destination_name.
  destination_name   text not null,
  poi_name           text not null,
  -- Which platforms the buzz was observed on: instagram, tiktok, reddit,
  -- youtube, blog, news, other.
  platforms          text[] not null default '{}',
  -- One-line collector summary of WHY it is trending (shown in logs/admin).
  reason             text not null default '',
  -- Grounding evidence: [{ uri, title, domain }] from the search-grounded call.
  evidence           jsonb not null default '[]'::jsonb,
  -- Collector-assigned buzz strength in [0,1] at collection time. The
  -- effective score decays from this with a 7-day half-life in code.
  raw_score          numeric not null default 0.5
                     check (raw_score >= 0 and raw_score <= 1),
  collected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  -- One live signal per place per destination; re-collection updates in place.
  unique (destination_name, place_id)
);

create index poi_trending_signals_destination_idx
  on poi_trending_signals (lower(destination_name));

create index poi_trending_signals_collected_at_idx
  on poi_trending_signals (collected_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table poi_trending_signals enable row level security;

create policy "no anon access" on poi_trending_signals for all to anon using (false);
