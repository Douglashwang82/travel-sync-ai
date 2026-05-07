-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — App users + trip-level membership
-- Migration: 20260507000000_app_users_and_trip_members
--
-- Adds first-class web-app accounts so users can register without going through
-- a LINE group, and lets trips exist without being bound to a LINE group.
--
-- Design:
--   * `app_users` is the canonical identity table for the /app experience.
--     It carries an email/password_hash for web-only registrations and a
--     `line_user_id` for users that signed in via LINE Login. The cookie that
--     the app-server helpers stamp continues to hold a `line_user_id` —
--     for email-only users we generate a synthetic one (`app_<uuid>`) so all
--     downstream tables that key on `line_user_id` keep working unchanged.
--
--   * `trip_members` lets a user join a trip directly, bypassing the LINE group
--     membership path. This is what the new "add user to existing trip" flow
--     writes to.
--
--   * `trips.group_id` becomes optional so a trip can be created/owned by an
--     app user that has no associated LINE group. The partial unique index
--     `trips_one_active_per_group_idx` is unaffected — Postgres treats NULL as
--     distinct in unique indexes, so multiple group-less active trips coexist.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── app_users ────────────────────────────────────────────────────────────────

create table app_users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  password_hash   text,
  line_user_id    text not null unique,
  display_name    text,
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Email-registered users must carry a password hash; LINE-only users may not.
  constraint app_users_email_password_check check (
    (email is null and password_hash is null)
    or (email is not null and password_hash is not null)
  ),
  -- At least one identity must be present.
  constraint app_users_identity_check check (
    email is not null or line_user_id like 'U%' or line_user_id like 'app_%'
  )
);

create index app_users_email_lower_idx on app_users (lower(email)) where email is not null;
create index app_users_line_user_id_idx on app_users (line_user_id);

create trigger app_users_updated_at
  before update on app_users
  for each row execute function update_updated_at_column();

alter table app_users enable row level security;
create policy "no anon access" on app_users for all to anon using (false);

-- ─── trip_members ─────────────────────────────────────────────────────────────
-- Direct trip-level membership for users that joined the trip without going
-- through a LINE group. Membership in a LINE group still grants access to all
-- trips under that group via group_members; this table is additive.

create table trip_members (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips (id) on delete cascade,
  app_user_id     uuid not null references app_users (id) on delete cascade,
  line_user_id    text not null,
  role            member_role not null default 'member',
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  unique (trip_id, app_user_id)
);

create index trip_members_trip_id_idx on trip_members (trip_id);
create index trip_members_app_user_id_idx on trip_members (app_user_id);
create index trip_members_line_user_id_idx on trip_members (line_user_id);

alter table trip_members enable row level security;
create policy "no anon access" on trip_members for all to anon using (false);

-- ─── trips.group_id is now optional ───────────────────────────────────────────

alter table trips
  alter column group_id drop not null;

-- ─── Backfill ─────────────────────────────────────────────────────────────────
-- Materialize an `app_users` row for every existing LINE user we've seen, so
-- the new session helpers can resolve their identity without a follow-up
-- write on first request. We pick the most recently-joined display_name when
-- a user belongs to multiple groups.

insert into app_users (line_user_id, display_name)
select
  gm.line_user_id,
  (
    select gm2.display_name
    from group_members gm2
    where gm2.line_user_id = gm.line_user_id
    order by gm2.joined_at desc
    limit 1
  )
from group_members gm
group by gm.line_user_id
on conflict (line_user_id) do nothing;
