-- Brainstorm ideas: lightweight pre-vote suggestions per trip
-- Members drop ideas with /idea; organizer promotes to /decide when ready
create table trip_ideas (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips (id) on delete cascade,
  group_id     uuid not null references line_groups (id) on delete cascade,
  submitted_by text not null,         -- line_user_id
  display_name text,                  -- submitter display name
  category     text not null default 'general',   -- destination|hotel|activity|restaurant|general
  text         text not null,
  promoted     boolean not null default false,     -- true once turned into a trip_item
  promoted_item_id uuid references trip_items (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index trip_ideas_trip_id_idx  on trip_ideas (trip_id);
create index trip_ideas_group_id_idx on trip_ideas (group_id);

alter table trip_ideas enable row level security;
create policy "no anon access" on trip_ideas for all to anon using (false);
