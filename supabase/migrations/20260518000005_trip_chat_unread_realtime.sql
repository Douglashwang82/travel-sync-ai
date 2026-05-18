-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip chat: unread tracking + realtime publication
-- Migration: 20260518000005_trip_chat_unread_realtime
--
-- Adds per-user "last read" timestamps on each trip-chat thread so the
-- workspace can render unread badges (in the chat navbar) and read receipts
-- (in the chatroom). Marks the relevant tables for Postgres logical
-- replication so the SSE relay can stream INSERTs in realtime.
-- ─────────────────────────────────────────────────────────────────────────────

create table trip_chat_thread_reads (
  thread_id     uuid not null references trip_chat_threads (id) on delete cascade,
  app_user_id   uuid not null references app_users (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (thread_id, app_user_id)
);

create index trip_chat_thread_reads_user_idx
  on trip_chat_thread_reads (app_user_id);

create trigger trip_chat_thread_reads_updated_at
  before update on trip_chat_thread_reads
  for each row execute function update_updated_at_column();

alter table trip_chat_thread_reads enable row level security;
create policy "no anon access" on trip_chat_thread_reads for all to anon using (false);

-- ─── Realtime publication ────────────────────────────────────────────────────
-- The default `supabase_realtime` publication is what supabase-js subscribes
-- to via `.channel(...).on('postgres_changes', ...)`. Add the chat tables so
-- inserts/updates fire change events. Wrap each ADD in DO blocks because
-- ALTER PUBLICATION fails if the table is already a member.

do $$
begin
  alter publication supabase_realtime add table trip_chat_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;  -- publication not present in some envs
end $$;

do $$
begin
  alter publication supabase_realtime add table trip_chat_thread_reads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
