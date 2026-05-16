-- Legacy no-op migration.
--
-- Version 20260515000000 was previously used by a migration filename collision.
-- Some databases may already have this version recorded in supabase_migrations.
-- Keep this placeholder so `supabase db push` can reconcile remote history.
select 1;
