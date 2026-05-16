-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Packing item provenance for agent-authored entries
-- Migration: 20260516000003_packing_items_provenance
--
-- Mirrors the columns added to `trip_items` and `trip_ideas` so the packing
-- suggester agent's writes carry the same audit trail. Read by the UI to
-- render "✦ AI" badges on agent-added lines.
-- ─────────────────────────────────────────────────────────────────────────────

alter table packing_items
  add column source_agent   text,
  add column source_run_id  uuid,
  add column source_inputs  jsonb;

create index packing_items_source_agent_idx
  on packing_items (source_agent)
  where source_agent is not null;
