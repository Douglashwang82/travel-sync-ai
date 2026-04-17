-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Tracking Lists
-- Migration: 20260417000000_tracking_lists
-- ─────────────────────────────────────────────────────────────────────────────
-- Users subscribe to external travel/restaurant sources (websites, public
-- social accounts). A daily cron fetches each source, stores a snapshot,
-- detects new items vs. the previous snapshot, and an LLM summarises them
-- for delivery through LINE (1:1 DM or group context).
-- ─────────────────────────────────────────────────────────────────────────────

create type tracking_source_type as enum (
  'website',      -- generic HTML page / blog
  'rss',          -- RSS / Atom feed
  'instagram',    -- public IG account (Graph API or scraper)
  'threads',      -- public Threads account
  'x',            -- public X (Twitter) account
  'youtube',      -- YouTube channel
  'tiktok'        -- public TikTok account
);

create type tracking_category as enum (
  'travel',
  'restaurant',
  'attraction',
  'event',
  'other'
);

create type tracking_run_status as enum (
  'pending',
  'running',
  'success',
  'failed',
  'skipped'        -- e.g. no changes detected, nothing to summarise
);

-- ─── 1. Tracking subscriptions (user-configured) ─────────────────────────────
create table tracking_lists (
  id                uuid primary key default gen_random_uuid(),
  line_user_id      text not null,
  group_id          uuid references line_groups (id) on delete set null,
  source_type       tracking_source_type not null,
  source_url        text not null,           -- canonical URL or handle (e.g. https://www.instagram.com/foo)
  display_name      text,                    -- user-friendly label
  category          tracking_category not null default 'travel',
  keywords          text[] not null default '{}',  -- optional keyword filter
  region            text,                    -- optional locale hint ("Tokyo", "台北")
  is_active         boolean not null default true,
  frequency_hours   integer not null default 24,   -- how often to poll
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  consecutive_failures integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index tracking_lists_user_url_uidx
  on tracking_lists (line_user_id, source_url);
create index tracking_lists_active_idx
  on tracking_lists (is_active, last_run_at);
create index tracking_lists_group_idx
  on tracking_lists (group_id);

-- ─── 2. Raw fetched snapshots (durable audit of each poll) ───────────────────
create table tracking_snapshots (
  id                uuid primary key default gen_random_uuid(),
  tracking_list_id  uuid not null references tracking_lists (id) on delete cascade,
  fetched_at        timestamptz not null default now(),
  http_status       integer,
  content_hash      text,                   -- sha256 of normalised body for change detection
  raw_excerpt       text,                   -- trimmed raw body (<= 20KB) for debugging
  item_count        integer not null default 0,
  error             text
);

create index tracking_snapshots_list_idx
  on tracking_snapshots (tracking_list_id, fetched_at desc);

-- ─── 3. Parsed items (structured entries extracted from each snapshot) ───────
create table tracking_items (
  id                uuid primary key default gen_random_uuid(),
  tracking_list_id  uuid not null references tracking_lists (id) on delete cascade,
  snapshot_id       uuid references tracking_snapshots (id) on delete set null,
  external_id       text,                   -- source-native id (post id, URL slug) for dedup
  title             text not null,
  summary           text,                   -- LLM-generated one-liner
  url               text,
  image_url         text,
  published_at      timestamptz,
  category          tracking_category,
  location          text,                   -- parsed venue / city
  tags              text[] not null default '{}',
  raw_json          jsonb,                  -- original parsed payload
  first_seen_at     timestamptz not null default now()
);

create unique index tracking_items_dedup_uidx
  on tracking_items (tracking_list_id, external_id)
  where external_id is not null;
create index tracking_items_list_published_idx
  on tracking_items (tracking_list_id, published_at desc);

-- ─── 4. Daily digest deliveries (what we sent to the user) ───────────────────
create table tracking_digests (
  id                uuid primary key default gen_random_uuid(),
  line_user_id      text not null,
  group_id          uuid references line_groups (id) on delete set null,
  digest_date       date not null,
  item_ids          uuid[] not null default '{}',
  summary_markdown  text not null,          -- final LLM summary delivered to user
  delivered_at      timestamptz,
  created_at        timestamptz not null default now()
);

create unique index tracking_digests_user_date_uidx
  on tracking_digests (line_user_id, digest_date);

-- ─── 5. Per-run log (observability for the cron) ─────────────────────────────
create table tracking_runs (
  id                uuid primary key default gen_random_uuid(),
  tracking_list_id  uuid not null references tracking_lists (id) on delete cascade,
  status            tracking_run_status not null default 'pending',
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  new_item_count    integer not null default 0,
  error             text
);

create index tracking_runs_list_started_idx
  on tracking_runs (tracking_list_id, started_at desc);

-- ─── RLS: server-only via admin client, mirror of direct_chat_messages ───────
alter table tracking_lists     enable row level security;
alter table tracking_snapshots enable row level security;
alter table tracking_items     enable row level security;
alter table tracking_digests   enable row level security;
alter table tracking_runs      enable row level security;
