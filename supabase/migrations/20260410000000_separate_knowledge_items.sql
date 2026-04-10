-- Separate knowledge-base items from voteable decision items.
--
-- A "knowledge" item is an interesting place, event, or fact a user noted
-- (via /add, /share, or AI parsing). It lives in the knowledge base so the
-- AI can draw on it when recommending or planning a trip. It never enters
-- the voting flow.
--
-- A "decision" item is something the group needs to vote on and confirm
-- (e.g. "Which hotel?"). This is the existing behaviour — unchanged.

CREATE TYPE item_kind AS ENUM ('knowledge', 'decision');

ALTER TABLE trip_items
  ADD COLUMN item_kind item_kind NOT NULL DEFAULT 'decision';

-- Back-fill: items created by the /share command or AI parsing of locations
-- are natural knowledge-base entries. Items with existing trip_item_options
-- are decision items (they were created ready-to-vote).
-- Since we cannot safely distinguish them without business logic here, we
-- leave existing rows as 'decision' — the migration is additive.

-- Index to make "fetch all knowledge items for a trip" fast.
CREATE INDEX trip_items_item_kind_idx ON trip_items (trip_id, item_kind);
