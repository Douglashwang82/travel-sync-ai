-- packing_items: per-trip packing checklist, per-member check-off
create table packing_items (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips (id) on delete cascade,
  group_id      uuid not null references line_groups (id) on delete cascade,
  label         text not null,
  category      text not null default 'general',  -- documents|clothing|toiletries|electronics|safety|general
  is_shared     boolean not null default true,     -- shown to all members
  added_by      text,                              -- line_user_id of creator (null = system)
  created_at    timestamptz not null default now()
);

create table packing_checks (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references packing_items (id) on delete cascade,
  line_user_id  text not null,
  checked_at    timestamptz not null default now(),
  unique (item_id, line_user_id)
);

create index packing_items_trip_id_idx on packing_items (trip_id);
create index packing_checks_item_id_idx on packing_checks (item_id);

alter table packing_items  enable row level security;
alter table packing_checks enable row level security;
create policy "no anon access" on packing_items  for all to anon using (false);
create policy "no anon access" on packing_checks for all to anon using (false);
