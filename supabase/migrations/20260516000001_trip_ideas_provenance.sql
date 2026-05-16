-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip idea provenance for AI proposals
-- Migration: 20260516000001_trip_ideas_provenance
--
-- Mirrors the columns added to `trip_items` so AI-authored ideas (e.g. from
-- the itinerary drafter agent) carry an audit trail and can be rendered
-- distinctly as "ghost" proposals in the Ideas tile.
-- ─────────────────────────────────────────────────────────────────────────────

alter table trip_ideas
  add column source_agent   text,
  add column source_run_id  uuid,
  add column source_inputs  jsonb;

create index trip_ideas_source_agent_idx
  on trip_ideas (source_agent)
  where source_agent is not null;
