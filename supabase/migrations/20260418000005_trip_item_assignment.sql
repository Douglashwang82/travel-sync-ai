-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip Item Assignment
-- Migration: 20260418000005_trip_item_assignment
-- ─────────────────────────────────────────────────────────────────────────────

-- Add assignment column: stores the LINE user ID of the person responsible.
-- Nullable — unassigned items have NULL.
alter table trip_items
  add column assigned_to_line_user_id text;

create index trip_items_assigned_to_idx
  on trip_items (assigned_to_line_user_id)
  where assigned_to_line_user_id is not null;
