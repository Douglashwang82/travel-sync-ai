-- Keep vector-search POI rows self-contained for curated/local place_ids.
-- Without live_data in the RPC result, enrichWithLiveData cannot see the
-- curated opening hours and may try to call Google Places with local IDs.
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
  order by p.embedding <=> p_query_embedding
  limit p_limit;
$$;
