-- ─────────────────────────────────────────────────────────────────────────────
-- Line Events: next_retry_at column
-- Migration: 20260503000000_line_events_next_retry_at
--
-- Adds exponential backoff to event reprocessing. Without this, the
-- process-events cron picks up every `failed` row on every run, hammering
-- LLM/DB on poison messages until retry_count saturates.
-- Mirrors the pattern added to outbound_messages in 20260412000001.
-- ─────────────────────────────────────────────────────────────────────────────

alter table line_events
  add column next_retry_at timestamptz;

-- Partial index so the retry sweeper only scans eligible rows.
create index line_events_next_retry_at_idx
  on line_events (next_retry_at)
  where processing_status = 'failed';

comment on column line_events.next_retry_at is
  'Earliest time this event should next be reprocessed. NULL = retry immediately.';
