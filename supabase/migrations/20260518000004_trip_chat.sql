-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip-scoped chat threads (member DMs + AI-agent chats)
-- Migration: 20260518000004_trip_chat
--
-- Powers the trip workspace left navbar: clicking a member opens a 1:1 DM
-- scoped to the trip; clicking an active AI agent opens a conversation with
-- that agent (the agent is identified by the trip's custom_grids row).
--
-- Two thread kinds share a single table so the messages table can stay
-- uniform. Uniqueness is enforced via partial indexes per kind:
--   * member_dm  → one thread per (trip, unordered pair of app_users)
--   * agent      → one thread per (trip, custom_grid)
--
-- For member_dm we normalize the pair so that (a,b) and (b,a) collide:
--   member_app_user_id_lo = least(uuid_a, uuid_b)
--   member_app_user_id_hi = greatest(uuid_a, uuid_b)
-- ─────────────────────────────────────────────────────────────────────────────

create type trip_chat_thread_kind as enum ('member_dm', 'agent');
create type trip_chat_sender_kind as enum ('user', 'agent');

create table trip_chat_threads (
  id                          uuid primary key default gen_random_uuid(),
  trip_id                     uuid not null references trips (id) on delete cascade,
  kind                        trip_chat_thread_kind not null,

  -- member_dm fields (null when kind = 'agent')
  member_app_user_id_lo       uuid references app_users (id) on delete cascade,
  member_app_user_id_hi       uuid references app_users (id) on delete cascade,

  -- agent fields (null when kind = 'member_dm')
  agent_custom_grid_id        uuid references custom_grids (id) on delete cascade,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint trip_chat_threads_kind_fields_check check (
    (kind = 'member_dm'
      and member_app_user_id_lo is not null
      and member_app_user_id_hi is not null
      and member_app_user_id_lo < member_app_user_id_hi
      and agent_custom_grid_id is null)
    or
    (kind = 'agent'
      and agent_custom_grid_id is not null
      and member_app_user_id_lo is null
      and member_app_user_id_hi is null)
  )
);

create unique index trip_chat_threads_member_dm_unique
  on trip_chat_threads (trip_id, member_app_user_id_lo, member_app_user_id_hi)
  where kind = 'member_dm';

create unique index trip_chat_threads_agent_unique
  on trip_chat_threads (trip_id, agent_custom_grid_id)
  where kind = 'agent';

create index trip_chat_threads_trip_idx on trip_chat_threads (trip_id);

create trigger trip_chat_threads_updated_at
  before update on trip_chat_threads
  for each row execute function update_updated_at_column();

alter table trip_chat_threads enable row level security;
create policy "no anon access" on trip_chat_threads for all to anon using (false);

-- ─── messages ────────────────────────────────────────────────────────────────

create table trip_chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references trip_chat_threads (id) on delete cascade,
  sender_kind         trip_chat_sender_kind not null,
  -- null when sender_kind = 'agent'
  sender_app_user_id  uuid references app_users (id) on delete set null,
  content             text not null,
  created_at          timestamptz not null default now(),

  constraint trip_chat_messages_sender_check check (
    (sender_kind = 'user'  and sender_app_user_id is not null) or
    (sender_kind = 'agent' and sender_app_user_id is null)
  )
);

create index trip_chat_messages_thread_idx
  on trip_chat_messages (thread_id, created_at asc);

alter table trip_chat_messages enable row level security;
create policy "no anon access" on trip_chat_messages for all to anon using (false);
