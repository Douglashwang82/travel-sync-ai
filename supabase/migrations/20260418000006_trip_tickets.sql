-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip Tickets
-- Migration: 20260418000006_trip_tickets
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores purchased tickets (flights, trains, museums, events, etc.)
-- shared across the trip group.

create table trip_tickets (
  id                      uuid primary key default gen_random_uuid(),
  trip_id                 uuid not null references trips (id) on delete cascade,
  group_id                uuid not null references line_groups (id) on delete cascade,
  added_by_line_user_id   text not null,
  ticket_type             text not null default 'other',
    -- flight | train | bus | ferry | museum | attraction | event | accommodation | other
  title                   text not null,
  vendor                  text,           -- e.g. "Klook", "Japan Airlines"
  reference_code          text,           -- booking / confirmation number
  passenger_name          text,           -- name on ticket (optional)
  valid_from              timestamptz,    -- when the ticket becomes valid
  valid_until             timestamptz,    -- when the ticket expires / is used
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index trip_tickets_trip_id_idx   on trip_tickets (trip_id);
create index trip_tickets_group_id_idx  on trip_tickets (group_id);
create index trip_tickets_valid_from_idx on trip_tickets (valid_from) where valid_from is not null;

create trigger trip_tickets_updated_at
  before update on trip_tickets
  for each row execute function update_updated_at_column();

alter table trip_tickets enable row level security;
create policy "no anon access" on trip_tickets for all to anon using (false);
