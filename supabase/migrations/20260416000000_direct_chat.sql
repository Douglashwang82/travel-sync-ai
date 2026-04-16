-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Direct Chat Messages
-- Migration: 20260416000000_direct_chat
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores conversation history for LINE 1:1 DMs with the bot.
-- group_id is the "context group" — the most recently active trip group
-- for this user, used to scope trip data for the AI response.
-- ─────────────────────────────────────────────────────────────────────────────

create type chat_role as enum ('user', 'agent');

create table direct_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text not null,
  group_id      uuid references line_groups (id) on delete set null,
  role          chat_role not null,
  content       text not null,
  created_at    timestamptz not null default now()
);

create index direct_chat_user_idx on direct_chat_messages (line_user_id, created_at desc);
create index direct_chat_group_idx on direct_chat_messages (group_id, created_at desc);

alter table direct_chat_messages enable row level security;
-- Server-side only via admin client — no public policies needed.
