-- RPC used by the process-events cron to atomically increment retry_count
-- before reprocessing, preventing concurrent worker double-processing.

create or replace function increment_retry_count(event_ids uuid[])
returns void
language sql
security definer
as $$
  update line_events
  set retry_count = retry_count + 1
  where id = any(event_ids);
$$;
