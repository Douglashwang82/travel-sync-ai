-- ─────────────────────────────────────────────────────────────────────────────
-- Rate Limit Windows
-- Migration: 20260412000000_rate_limit_windows
--
-- Replaces the in-memory sliding-window limiter in lib/rate-limit.ts.
-- In-memory state resets on every Vercel cold start, making rate limits
-- ineffective in serverless. This table persists counts across instances.
-- ─────────────────────────────────────────────────────────────────────────────

create table rate_limit_windows (
  key          text        not null,   -- e.g. "group:Cabc123" or "user:Uabc123"
  window_start timestamptz not null,   -- truncated to the window boundary
  count        integer     not null default 1,
  primary key (key, window_start)
);

-- Index to speed up cleanup of expired windows
create index rate_limit_windows_window_start_idx on rate_limit_windows (window_start);

-- ─── Atomic check-and-increment RPC ──────────────────────────────────────────
-- Inserts a new window row or increments the count atomically.
-- Returns the count AFTER incrementing (caller checks against max).
create or replace function rate_limit_increment(
  p_key          text,
  p_window_start timestamptz,
  p_max_requests integer
) returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  insert into rate_limit_windows (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start) do update
    set count = rate_limit_windows.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

-- ─── Cleanup function (called by cleanup cron) ────────────────────────────────
-- Deletes windows older than 5 minutes to prevent unbounded table growth.
create or replace function rate_limit_cleanup()
returns void
language sql
security definer
as $$
  delete from rate_limit_windows
  where window_start < now() - interval '5 minutes';
$$;

-- RLS: this table is only accessed via service role (admin client) and the
-- security definer RPCs above — no client-facing access needed.
alter table rate_limit_windows enable row level security;
