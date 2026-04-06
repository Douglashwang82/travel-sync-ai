-- ─────────────────────────────────────────────────────────────────────────────
-- Add tie_extension_count to trip_items
-- Migration: 20260405000000_add_tie_extension_count
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks how many times a tied vote has been extended.
-- Used to cap infinite tie extensions and escalate to the organizer.

alter table trip_items
  add column tie_extension_count integer not null default 0;
