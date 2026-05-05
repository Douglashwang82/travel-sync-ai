-- Add day_notes column to trips so the group can pin a one-line summary
-- to each day of the itinerary (e.g. "Travel day: Osaka → Kyoto").
--
-- Stored as a jsonb map keyed by ISO date string ("YYYY-MM-DD"):
--   { "2026-07-15": { "note": "Arrival + dinner", "updatedBy": "U…", "updatedAt": "…" } }
--
-- Editable by any group member; the UI shows last-updated-by attribution.
alter table trips
  add column if not exists day_notes jsonb not null default '{}'::jsonb;
