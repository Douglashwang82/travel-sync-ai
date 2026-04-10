create table trip_memories (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trips (id) on delete cascade,
  group_id            uuid not null references line_groups (id) on delete cascade,
  item_type           item_type not null,
  title               text not null,
  canonical_key       text not null,
  summary             text,
  address             text,
  rating              numeric(2,1),
  price_level         text,
  image_url           text,
  booking_url         text,
  source_line_user_id text,
  source_event_id     uuid references line_events (id) on delete set null,
  mention_count       integer not null default 1,
  last_mentioned_at   timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (trip_id, item_type, canonical_key)
);

create index trip_memories_trip_id_idx on trip_memories (trip_id);
create index trip_memories_group_id_idx on trip_memories (group_id);
create index trip_memories_item_type_idx on trip_memories (item_type);
create index trip_memories_last_mentioned_at_idx on trip_memories (last_mentioned_at desc);

create trigger trip_memories_updated_at
  before update on trip_memories
  for each row execute function update_updated_at_column();

alter table trip_memories enable row level security;
