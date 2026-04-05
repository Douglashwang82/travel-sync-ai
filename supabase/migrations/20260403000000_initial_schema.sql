-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Initial Schema
-- Migration: 20260403000000_initial_schema
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable gen_random_uuid()
create extension if not exists "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type group_status as enum ('active', 'removed', 'archived');
create type member_role as enum ('organizer', 'member');
create type trip_status as enum ('draft', 'active', 'completed', 'cancelled');
create type item_type as enum ('hotel', 'restaurant', 'activity', 'transport', 'insurance', 'flight', 'other');
create type item_stage as enum ('todo', 'pending', 'confirmed');
create type item_source as enum ('ai', 'command', 'manual', 'system');
create type option_provider as enum ('google_places', 'ota', 'manual');
create type entity_type as enum ('date', 'date_range', 'location', 'flight', 'hotel', 'preference', 'budget', 'constraint', 'conflict');
create type event_processing_status as enum ('pending', 'processing', 'processed', 'failed');

-- ─── line_groups ──────────────────────────────────────────────────────────────

create table line_groups (
  id              uuid primary key default gen_random_uuid(),
  line_group_id   text not null unique,
  name            text,
  status          group_status not null default 'active',
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index line_groups_line_group_id_idx on line_groups (line_group_id);
create index line_groups_status_idx on line_groups (status);

-- ─── group_members ────────────────────────────────────────────────────────────

create table group_members (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references line_groups (id) on delete cascade,
  line_user_id    text not null,
  display_name    text,
  role            member_role not null default 'member',
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  unique (group_id, line_user_id)
);

create index group_members_group_id_idx on group_members (group_id);
create index group_members_line_user_id_idx on group_members (line_user_id);

-- ─── trips ────────────────────────────────────────────────────────────────────

create table trips (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references line_groups (id) on delete cascade,
  title                 text,
  destination_name      text not null,
  destination_place_id  text,
  start_date            date,
  end_date              date,
  status                trip_status not null default 'draft',
  created_by_user_id    text not null,
  created_at            timestamptz not null default now(),
  ended_at              timestamptz
);

create index trips_group_id_idx on trips (group_id);
create index trips_status_idx on trips (status);
-- Enforce only one active trip per group in MVP
create unique index trips_one_active_per_group_idx
  on trips (group_id)
  where status in ('draft', 'active');

-- ─── trip_items ───────────────────────────────────────────────────────────────

create table trip_items (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references trips (id) on delete cascade,
  item_type             item_type not null default 'other',
  title                 text not null,
  description           text,
  stage                 item_stage not null default 'todo',
  source                item_source not null default 'manual',
  status_reason         text,
  confirmed_option_id   uuid,          -- FK added after trip_item_options is created
  deadline_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index trip_items_trip_id_idx on trip_items (trip_id);
create index trip_items_stage_idx on trip_items (stage);
create index trip_items_deadline_at_idx on trip_items (deadline_at) where deadline_at is not null;

-- Auto-update updated_at
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trip_items_updated_at
  before update on trip_items
  for each row execute function update_updated_at_column();

-- ─── trip_item_options ────────────────────────────────────────────────────────

create table trip_item_options (
  id                uuid primary key default gen_random_uuid(),
  trip_item_id      uuid not null references trip_items (id) on delete cascade,
  provider          option_provider not null default 'manual',
  external_ref      text,
  name              text not null,
  image_url         text,
  rating            numeric(2,1),
  price_level       text,
  distance_meters   integer,
  address           text,
  booking_url       text,
  metadata_json     jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create index trip_item_options_trip_item_id_idx on trip_item_options (trip_item_id);

-- Now add the FK from trip_items.confirmed_option_id
alter table trip_items
  add constraint trip_items_confirmed_option_id_fkey
  foreign key (confirmed_option_id) references trip_item_options (id)
  on delete set null;

-- ─── votes ────────────────────────────────────────────────────────────────────

create table votes (
  id              uuid primary key default gen_random_uuid(),
  trip_item_id    uuid not null references trip_items (id) on delete cascade,
  option_id       uuid not null references trip_item_options (id) on delete cascade,
  group_id        uuid not null references line_groups (id) on delete cascade,
  line_user_id    text not null,
  cast_at         timestamptz not null default now(),
  unique (trip_item_id, line_user_id)   -- one vote per user per decision
);

create index votes_trip_item_id_idx on votes (trip_item_id);
create index votes_option_id_idx on votes (option_id);

-- ─── parsed_entities ──────────────────────────────────────────────────────────

create table parsed_entities (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references line_groups (id) on delete cascade,
  trip_id           uuid references trips (id) on delete set null,
  line_event_id     uuid not null,     -- FK to line_events (defined below)
  entity_type       entity_type not null,
  canonical_value   text not null,
  display_value     text not null,
  confidence_score  numeric(4,3) not null check (confidence_score between 0 and 1),
  attributes_json   jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create index parsed_entities_group_id_idx on parsed_entities (group_id);
create index parsed_entities_trip_id_idx on parsed_entities (trip_id);
create index parsed_entities_entity_type_idx on parsed_entities (entity_type);

-- ─── line_events ──────────────────────────────────────────────────────────────

create table line_events (
  id                  uuid primary key default gen_random_uuid(),
  line_event_uid      text not null unique,
  group_id            uuid references line_groups (id) on delete set null,
  event_type          text not null,
  payload_json        jsonb not null default '{}',
  processing_status   event_processing_status not null default 'pending',
  failure_reason      text,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  retry_count         integer not null default 0
);

create index line_events_processing_status_idx on line_events (processing_status);
create index line_events_group_id_idx on line_events (group_id);
create index line_events_received_at_idx on line_events (received_at);

-- Add deferred FK from parsed_entities to line_events
alter table parsed_entities
  add constraint parsed_entities_line_event_id_fkey
  foreign key (line_event_id) references line_events (id)
  on delete cascade;

-- ─── raw_messages ─────────────────────────────────────────────────────────────

create table raw_messages (
  id              uuid primary key default gen_random_uuid(),
  line_event_id   uuid not null references line_events (id) on delete cascade,
  group_id        uuid not null references line_groups (id) on delete cascade,
  line_user_id    text not null,
  message_text    text not null,
  language_hint   text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days')
);

create index raw_messages_group_id_idx on raw_messages (group_id);
create index raw_messages_expires_at_idx on raw_messages (expires_at);

-- ─── outbound_messages ────────────────────────────────────────────────────────

create table outbound_messages (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid references line_groups (id) on delete set null,
  line_event_id     uuid references line_events (id) on delete set null,
  message_type      text not null,            -- 'text' | 'flex'
  payload_json      jsonb not null default '{}',
  status            text not null default 'pending',  -- 'pending' | 'sent' | 'failed'
  failure_reason    text,
  sent_at           timestamptz,
  retry_count       integer not null default 0,
  created_at        timestamptz not null default now()
);

create index outbound_messages_status_idx on outbound_messages (status);
create index outbound_messages_group_id_idx on outbound_messages (group_id);

-- ─── analytics_events ─────────────────────────────────────────────────────────

create table analytics_events (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,
  group_id      uuid references line_groups (id) on delete set null,
  user_id       text,
  properties    jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index analytics_events_event_name_idx on analytics_events (event_name);
create index analytics_events_group_id_idx on analytics_events (group_id);
create index analytics_events_created_at_idx on analytics_events (created_at);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- All tables are only accessible server-side (service role) except where noted.
-- LIFF pages read trip/board data authenticated via LINE session resolved server-side.

alter table line_groups enable row level security;
alter table group_members enable row level security;
alter table trips enable row level security;
alter table trip_items enable row level security;
alter table trip_item_options enable row level security;
alter table votes enable row level security;
alter table parsed_entities enable row level security;
alter table line_events enable row level security;
alter table raw_messages enable row level security;
alter table outbound_messages enable row level security;
alter table analytics_events enable row level security;

-- Service role bypasses RLS — no explicit policies needed for server-side access.
-- Add LIFF read policies here when LIFF auth is wired up.
