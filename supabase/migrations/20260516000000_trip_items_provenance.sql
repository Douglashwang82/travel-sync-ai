-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Trip item provenance for AI writes
-- Migration: 20260516000000_trip_items_provenance
--
-- When `source = 'ai'`, we want to know *which* agent wrote the row and what
-- it was reasoning from. This is the foundation for the bento workspace's
-- "Why?" side sheet and for safe undo of agent-applied changes.
--
-- All three columns are nullable — existing AI rows (from the LINE parsing
-- pipeline pre-this-migration) keep `source = 'ai'` with these blank.
-- ─────────────────────────────────────────────────────────────────────────────

alter table trip_items
  add column source_agent   text,        -- agent registry key (e.g. 'flight_price_tracker', 'group_chat_parser')
  add column source_run_id  uuid,        -- soft FK to custom_grid_runs.id or agent_runs.id; not enforced so cascades stay simple
  add column source_inputs  jsonb;       -- trimmed inputs the agent saw (e.g. the chat snippet, the prompt config)

create index trip_items_source_agent_idx
  on trip_items (source_agent)
  where source_agent is not null;
