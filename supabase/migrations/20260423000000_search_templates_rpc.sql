-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Template Search RPC
-- Migration: 20260423000000_search_templates_rpc
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns public + request_only templates joined with their current version,
-- filtered by query text, tags, and duration, ordered by the requested sort.
-- Private templates never appear — their existence must not leak.

create or replace function search_templates(
  p_q             text     default null,
  p_tags          text[]   default null,
  p_duration_min  integer  default null,
  p_duration_max  integer  default null,
  p_sort          text     default 'recent',
  p_limit         integer  default 20,
  p_offset        integer  default 0
) returns table (
  slug                      text,
  visibility                template_visibility,
  fork_count                integer,
  like_count                integer,
  comment_count             integer,
  author_line_user_id       text,
  version_title             text,
  version_destination_name  text,
  version_duration_days     integer,
  version_summary           text,
  version_cover_image_url   text,
  version_tags              text[],
  version_published_at      timestamptz
)
language sql
security definer
stable
as $$
  select
    t.slug,
    t.visibility,
    t.fork_count,
    t.like_count,
    t.comment_count,
    t.author_line_user_id,
    v.title,
    v.destination_name,
    v.duration_days,
    v.summary,
    v.cover_image_url,
    v.tags,
    v.published_at
  from trip_templates t
  join trip_template_versions v on v.id = t.current_version_id
  where t.deleted_at is null
    and t.visibility in ('public', 'request_only')
    and (p_q is null or p_q = ''
         or v.title ilike '%' || p_q || '%'
         or v.destination_name ilike '%' || p_q || '%')
    and (p_tags is null or array_length(p_tags, 1) is null or v.tags && p_tags)
    and (p_duration_min is null or v.duration_days >= p_duration_min)
    and (p_duration_max is null or v.duration_days <= p_duration_max)
  order by
    case when p_sort = 'forks'  then t.fork_count end desc nulls last,
    case when p_sort = 'likes'  then t.like_count end desc nulls last,
    case when p_sort = 'recent' then v.published_at end desc nulls last,
    t.created_at desc
  limit  greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$$;
