-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Per-grid autonomy dial
-- Migration: 20260516000002_custom_grids_autonomy
--
-- Each custom grid carries a trust dial that governs how aggressively its
-- agent applies its own output:
--
--   propose_only          — write to the ghost lane only (default; safest)
--   auto_apply_with_undo  — write to ghost lane AND apply, leaving an undo
--   auto_apply            — write to ghost lane AND apply, no undo prompt
--
-- "Apply" is agent-specific. For itinerary_drafter, it means promoting a
-- suggestion to a trip_item. For monitor agents (flight/weather), there is
-- nothing to apply, so the value is informational only.
-- ─────────────────────────────────────────────────────────────────────────────

create type agent_autonomy as enum (
  'propose_only',
  'auto_apply_with_undo',
  'auto_apply'
);

alter table custom_grids
  add column autonomy agent_autonomy not null default 'propose_only';
