-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Group chat thread shape (constraint + uniqueness)
-- Migration: 20260601000001_trip_chat_group_thread
--
-- Allows kind = 'group' rows where every member/agent pointer is NULL, and
-- enforces a single group thread per trip. Builds on the enum value added in
-- 20260601000000_trip_chat_group_kind.
-- ─────────────────────────────────────────────────────────────────────────────

alter table trip_chat_threads
  drop constraint trip_chat_threads_kind_fields_check;

alter table trip_chat_threads
  add constraint trip_chat_threads_kind_fields_check check (
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
    or
    (kind = 'group'
      and member_app_user_id_lo is null
      and member_app_user_id_hi is null
      and agent_custom_grid_id is null)
  );

-- One group room per trip.
create unique index trip_chat_threads_group_unique
  on trip_chat_threads (trip_id)
  where kind = 'group';
