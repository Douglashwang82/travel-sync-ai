-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip canvas workspace layouts
-- Migration: 20260701000000_trip_canvas_layouts
--
-- The trip overview is a free-form pan & zoom canvas. Each member arranges
-- their own board, so layout is stored per (trip, app_user) and follows the
-- user across devices. `tiles` holds absolute positions/sizes in world space
-- ([{ id, x, y, w, h }]); `viewport` holds the last pan/zoom
-- ({ zoom, panX, panY }) so the board reopens where it was left.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists trip_canvas_layouts (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips (id) on delete cascade,
  app_user_id  uuid not null references app_users (id) on delete cascade,
  tiles        jsonb not null default '[]'::jsonb,   -- [{ id, x, y, w, h }] in world coords
  viewport     jsonb not null default '{}'::jsonb,   -- { zoom, panX, panY }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (trip_id, app_user_id)
);

create index if not exists trip_canvas_layouts_trip_idx
  on trip_canvas_layouts (trip_id);

drop trigger if exists trip_canvas_layouts_updated_at on trip_canvas_layouts;
create trigger trip_canvas_layouts_updated_at
  before update on trip_canvas_layouts
  for each row execute function update_updated_at_column();

alter table trip_canvas_layouts enable row level security;
do $$
begin
  create policy "no anon access" on trip_canvas_layouts for all to anon using (false);
exception
  when duplicate_object then null;
end $$;
