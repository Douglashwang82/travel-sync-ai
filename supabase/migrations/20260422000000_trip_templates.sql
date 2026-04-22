-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip Templates (Sharing & Discovery)
-- Migration: 20260422000000_trip_templates
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type template_visibility as enum ('public', 'private', 'request_only');
create type access_request_status as enum ('pending', 'approved', 'denied');
create type template_grant_source as enum ('invite', 'request');

-- ─── trip_templates ───────────────────────────────────────────────────────────
-- Header record for a published template. Denormalized counts kept here for
-- fast list/search queries without joining child tables.

create table trip_templates (
  id                    uuid primary key default gen_random_uuid(),
  author_line_user_id   text not null,
  slug                  text not null unique,
  current_version_id    uuid,                    -- FK added after trip_template_versions
  visibility            template_visibility not null default 'public',
  fork_count            integer not null default 0,
  like_count            integer not null default 0,
  comment_count         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index trip_templates_author_idx      on trip_templates (author_line_user_id) where deleted_at is null;
create index trip_templates_visibility_idx  on trip_templates (visibility) where deleted_at is null;
create index trip_templates_like_count_idx  on trip_templates (like_count desc) where deleted_at is null;
create index trip_templates_fork_count_idx  on trip_templates (fork_count desc) where deleted_at is null;
create index trip_templates_created_at_idx  on trip_templates (created_at desc) where deleted_at is null;

create trigger trip_templates_updated_at
  before update on trip_templates
  for each row execute function update_updated_at_column();

-- ─── trip_template_versions ───────────────────────────────────────────────────
-- Immutable snapshot of a trip published as a template.
-- Each publish creates a new version row; trip_templates.current_version_id
-- points at the latest one.

create table trip_template_versions (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references trip_templates (id) on delete cascade,
  version_number    integer not null,
  source_trip_id    uuid references trips (id) on delete set null,
  title             text not null,
  destination_name  text not null,
  duration_days     integer not null check (duration_days > 0),
  summary           text,
  cover_image_url   text,
  tags              text[] not null default '{}',
  content_hash      text not null,          -- sha256 of canonical items JSON; blocks identical republish
  published_at      timestamptz not null default now(),
  unique (template_id, version_number)
);

create index trip_template_versions_template_id_idx on trip_template_versions (template_id);
create index trip_template_versions_destination_idx  on trip_template_versions (lower(destination_name));
create index trip_template_versions_duration_idx     on trip_template_versions (duration_days);
create index trip_template_versions_tags_idx         on trip_template_versions using gin (tags);

-- Back-fill the deferred FK
alter table trip_templates
  add constraint trip_templates_current_version_id_fkey
  foreign key (current_version_id) references trip_template_versions (id)
  on delete set null;

-- ─── trip_template_items ─────────────────────────────────────────────────────
-- Day-relative itinerary items copied from the source trip at publish time.
-- Strips: prices, tickets, votes, member PII, booking refs.

create table trip_template_items (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references trip_template_versions (id) on delete cascade,
  day_number       integer not null check (day_number >= 1),
  order_index      integer not null default 0,
  item_type        item_type not null default 'other',
  title            text not null,
  notes            text,
  place_name       text,
  address          text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  external_url     text,
  duration_minutes integer check (duration_minutes > 0)
);

create index trip_template_items_version_day_idx on trip_template_items (version_id, day_number, order_index);

-- ─── template_likes ───────────────────────────────────────────────────────────

create table template_likes (
  template_id    uuid not null references trip_templates (id) on delete cascade,
  line_user_id   text not null,
  created_at     timestamptz not null default now(),
  primary key (template_id, line_user_id)
);

create index template_likes_user_idx on template_likes (line_user_id);

-- ─── template_comments ────────────────────────────────────────────────────────
-- Flat (non-threaded) comments. Soft-deleted rows show "[deleted]" in the UI.
-- edited_at non-null → show "edited" tag in the UI.

create table template_comments (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references trip_templates (id) on delete cascade,
  line_user_id   text not null,
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  deleted_at     timestamptz
);

create index template_comments_template_id_idx on template_comments (template_id, created_at)
  where deleted_at is null;

-- ─── template_access_requests ────────────────────────────────────────────────
-- Used for request_only templates. One pending request per user per template.
-- Approving writes a row to template_grants.

create table template_access_requests (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references trip_templates (id) on delete cascade,
  requester_user_id   text not null,
  status              access_request_status not null default 'pending',
  message             text check (message is null or char_length(message) <= 500),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (template_id, requester_user_id)   -- one open request per user per template
);

create index template_access_requests_template_status_idx on template_access_requests (template_id, status);
create index template_access_requests_user_idx            on template_access_requests (requester_user_id);

-- ─── template_grants ─────────────────────────────────────────────────────────
-- Explicit access grants for private and request_only templates.
-- Source 'invite' = author-initiated; 'request' = approved from access request.

create table template_grants (
  template_id    uuid not null references trip_templates (id) on delete cascade,
  line_user_id   text not null,
  granted_at     timestamptz not null default now(),
  granted_by     text not null,
  source         template_grant_source not null,
  primary key (template_id, line_user_id)
);

create index template_grants_user_idx on template_grants (line_user_id);

-- ─── template_reports ────────────────────────────────────────────────────────
-- Exactly one of template_id or comment_id must be set (checked below).

create table template_reports (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid references trip_templates (id) on delete cascade,
  comment_id        uuid references template_comments (id) on delete cascade,
  reporter_user_id  text not null,
  reason            text not null check (char_length(reason) between 1 and 1000),
  created_at        timestamptz not null default now(),
  constraint template_reports_target_check check (
    (template_id is not null and comment_id is null) or
    (template_id is null     and comment_id is not null)
  )
);

create index template_reports_template_id_idx on template_reports (template_id) where template_id is not null;
create index template_reports_comment_id_idx  on template_reports (comment_id)  where comment_id  is not null;

-- ─── notifications ────────────────────────────────────────────────────────────
-- In-app inbox. Valid kind values:
--   template.access_requested | template.access_approved | template.access_denied
--   template.invited | template.new_comment | template.forked

create table notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_user_id   text not null,
  kind                text not null,
  payload             jsonb not null default '{}',
  read_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index notifications_recipient_unread_idx on notifications (recipient_user_id, created_at desc)
  where read_at is null;
create index notifications_created_at_idx       on notifications (created_at);

-- ─── Add forked_from_version_id to trips ─────────────────────────────────────

alter table trips
  add column forked_from_version_id uuid references trip_template_versions (id) on delete set null;

-- ─── Anti-spam RPCs ───────────────────────────────────────────────────────────

-- Returns how many templates an author has created in the last 24 hours.
-- API enforces ≤3 new templates/day per author.
create or replace function count_author_templates_today(p_author_line_user_id text)
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from trip_templates
  where author_line_user_id = p_author_line_user_id
    and created_at >= now() - interval '24 hours'
    and deleted_at is null;
$$;

-- Returns how many versions a template has published in the last 24 hours.
-- API enforces ≤1 new version/template/day.
create or replace function count_template_versions_today(p_template_id uuid)
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from trip_template_versions
  where template_id = p_template_id
    and published_at >= now() - interval '24 hours';
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

alter table trip_templates           enable row level security;
alter table trip_template_versions   enable row level security;
alter table trip_template_items      enable row level security;
alter table template_likes           enable row level security;
alter table template_comments        enable row level security;
alter table template_access_requests enable row level security;
alter table template_grants          enable row level security;
alter table template_reports         enable row level security;
alter table notifications            enable row level security;

create policy "no anon access" on trip_templates           for all to anon using (false);
create policy "no anon access" on trip_template_versions   for all to anon using (false);
create policy "no anon access" on trip_template_items      for all to anon using (false);
create policy "no anon access" on template_likes           for all to anon using (false);
create policy "no anon access" on template_comments        for all to anon using (false);
create policy "no anon access" on template_access_requests for all to anon using (false);
create policy "no anon access" on template_grants          for all to anon using (false);
create policy "no anon access" on template_reports         for all to anon using (false);
create policy "no anon access" on notifications            for all to anon using (false);
