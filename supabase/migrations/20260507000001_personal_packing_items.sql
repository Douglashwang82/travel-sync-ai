-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Personal Packing Items
-- Migration: 20260507000001_personal_packing_items
-- ─────────────────────────────────────────────────────────────────────────────
-- Private per-user packing checklist scoped to a single trip.
-- Distinct from the group-shared `packing_items` table:
--   * `packing_items` is collaborative — visible to every member of the trip's
--     group, with per-member check-off via `packing_checks`.
--   * `personal_packing_items` is private to the owning LINE user. No one else
--     in the trip's group can read or write rows. Each row carries its own
--     packed flag (no separate checks table needed).
--
-- A user is allowed to own rows for any trip whose group they are a member of;
-- the API layer enforces trip-membership at write time. RLS denies anon access
-- entirely — server-side admin client is the only reader/writer.

create table personal_packing_items (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips (id) on delete cascade,
  line_user_id  text not null,
  label         text not null,
  category      text not null default 'general',
    -- documents | clothing | toiletries | electronics | health | general
  is_packed     boolean not null default false,
  packed_at     timestamptz,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index personal_packing_items_owner_idx
  on personal_packing_items (line_user_id, trip_id);

create index personal_packing_items_trip_idx
  on personal_packing_items (trip_id);

alter table personal_packing_items enable row level security;
create policy "no anon access" on personal_packing_items
  for all to anon using (false);
