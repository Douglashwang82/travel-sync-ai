-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Cross-trip semantic recall for trip_memories
-- Migration: 20260523000001_trip_memory_embeddings
--
-- Extends services/memory from per-trip canonical-key dedup to org-wide
-- semantic recall. When a user asks "places like Tatami in Kyoto", the
-- assistant queries match_trip_memories(embed(query)) and pulls back the
-- top-K closest places across all their trips.
--
-- Implementation:
--   - new column trip_memories.embedding vector(768)
--   - HNSW index for fast cosine-similarity search
--   - match_trip_memories(query_embedding, match_count, owner_group_id)
--     RPC that filters to the caller's group memberships (scoping is
--     enforced in services/memory/recall.ts, not in the SQL function — the
--     function is intentionally caller-trusted because only service-role
--     clients can call it).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists vector;

alter table trip_memories
  add column if not exists embedding vector(768);

-- HNSW outperforms IVFFlat for our scale (low-thousands of rows) and doesn't
-- need a maintenance step after backfills. Cosine distance because all our
-- embedding work is cosine-normalized.
create index if not exists trip_memories_embedding_hnsw
  on trip_memories
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Match function. The caller is responsible for filtering to groups the
-- requesting user belongs to — this function does not enforce scoping.
create or replace function match_trip_memories(
  query_embedding vector(768),
  match_count int default 8,
  group_ids uuid[] default null
)
returns table (
  id uuid,
  trip_id uuid,
  group_id uuid,
  item_type text,
  title text,
  address text,
  similarity float
)
language sql stable as $$
  select
    tm.id,
    tm.trip_id,
    tm.group_id,
    tm.item_type::text,
    tm.title,
    tm.address,
    1 - (tm.embedding <=> query_embedding) as similarity
  from trip_memories tm
  where tm.embedding is not null
    and (group_ids is null or tm.group_id = any(group_ids))
  order by tm.embedding <=> query_embedding
  limit match_count;
$$;
