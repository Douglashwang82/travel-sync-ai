-- ─────────────────────────────────────────────────────────────────────────────
-- Outbound Messages: next_retry_at column
-- Migration: 20260412000001_outbound_next_retry_at
--
-- Adds exponential backoff to outbound message retries. When a push message
-- fails, next_retry_at is set to now() + 2^retry_count seconds so the cron
-- doesn't hammer LINE's API on every run after a transient failure.
-- ─────────────────────────────────────────────────────────────────────────────

alter table outbound_messages
  add column next_retry_at timestamptz;

-- Index so the retry query only scans eligible rows
create index outbound_messages_next_retry_at_idx
  on outbound_messages (next_retry_at)
  where status = 'failed';

comment on column outbound_messages.next_retry_at is
  'Earliest time this message should next be retried. NULL means retry immediately.';
