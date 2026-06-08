-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Add 'group' to the trip chat thread kind enum
-- Migration: 20260601000000_trip_chat_group_kind
--
-- The workspace redesign makes a shared group chat room the primary surface.
-- A group thread is a singleton per trip (all members + the AI orchestrator
-- participate), distinct from the existing 1:1 member_dm and per-agent threads.
--
-- Postgres requires a newly added enum value to be committed before it can be
-- referenced, so this ADD VALUE lives in its own migration. The constraint and
-- index that depend on it land in 20260601000001_trip_chat_group_thread.
-- ─────────────────────────────────────────────────────────────────────────────

alter type trip_chat_thread_kind add value if not exists 'group';
