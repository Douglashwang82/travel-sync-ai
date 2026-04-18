-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: explicit deny-all for anon role on every table
-- Migration: 20260418000000_rls_no_anon_access
--
-- All application access goes through the service-role admin client (server-side
-- API routes). No table should ever be reachable by the anon key. RLS is already
-- ENABLED on every table; this migration adds explicit policies so the intent is
-- unambiguous and future Supabase tooling can't accidentally open access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Core tables (initial schema) ────────────────────────────────────────────

create policy "no anon access" on line_groups          for all to anon using (false);
create policy "no anon access" on group_members        for all to anon using (false);
create policy "no anon access" on trips                for all to anon using (false);
create policy "no anon access" on trip_items           for all to anon using (false);
create policy "no anon access" on trip_item_options    for all to anon using (false);
create policy "no anon access" on votes                for all to anon using (false);
create policy "no anon access" on parsed_entities      for all to anon using (false);
create policy "no anon access" on line_events          for all to anon using (false);
create policy "no anon access" on raw_messages         for all to anon using (false);
create policy "no anon access" on outbound_messages    for all to anon using (false);
create policy "no anon access" on analytics_events     for all to anon using (false);

-- ─── Expenses (already has policies — skip, would conflict) ──────────────────
-- expenses and expense_splits already have "no anon access" from 20260405000000

-- ─── Later-added tables ───────────────────────────────────────────────────────

create policy "no anon access" on trip_memories        for all to anon using (false);
create policy "no anon access" on rate_limit_windows   for all to anon using (false);
create policy "no anon access" on direct_chat_messages for all to anon using (false);
create policy "no anon access" on tracking_lists       for all to anon using (false);
create policy "no anon access" on tracking_snapshots   for all to anon using (false);
create policy "no anon access" on tracking_items       for all to anon using (false);
create policy "no anon access" on tracking_digests     for all to anon using (false);
create policy "no anon access" on tracking_runs        for all to anon using (false);
