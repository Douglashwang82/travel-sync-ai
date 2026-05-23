---
description: Create a timestamped Supabase migration and remind to regenerate database.types.ts.
argument-hint: <snake_case_description>
---

Create a Supabase migration.

**Arguments:** `$ARGUMENTS` — snake_case slug describing the change (e.g. `add_llm_calls_table`).

Steps:

1. Compute the next timestamp by reading the latest filename in `supabase/migrations/` and incrementing the date prefix.
2. Create `supabase/migrations/<timestamp>_<slug>.sql` with the standard header comment block (purpose, why, downstream impact).
3. Apply it locally: `npx supabase db push` (ask the user before running if you're not sure the local DB is ephemeral).
4. Regenerate types: `npx supabase gen types typescript --linked > lib/database.types.ts`.
5. Run `npm run build` to confirm the new types compile against the codebase.

Never drop or rename a column without an explicit user OK — it can wedge in-flight rows.
