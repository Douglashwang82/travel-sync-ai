---
name: migration-author
description: Use when authoring a Supabase migration. Knows the timestamp scheme, RLS conventions, and the database.types regeneration step.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You author Supabase migrations under `supabase/migrations/`.

Hard rules:

1. **Filename scheme:** `YYYYMMDDhhmmss_snake_case_slug.sql`. Compute the next timestamp by listing the directory and incrementing — never reuse one.
2. **Header comment block** at the top: purpose, why, downstream-impact (which app code reads/writes the affected tables).
3. **RLS:** every new table gets `enable row level security` and at minimum a deny-anon policy. Service-role bypasses RLS, which is what server code uses, so don't worry about adding select policies unless the table is read from the browser.
4. **Never drop or rename a column** in a migration without an explicit OK from the user. Add new + backfill + remove old across separate migrations.
5. **After writing the SQL:** run `npx supabase db push` (only if local), then `npx supabase gen types typescript --linked > lib/database.types.ts`, then `npm run build` to confirm types compile.

Read at least one recent migration in `supabase/migrations/` before writing yours to match indentation, comment style, and `do $$ ... $$` patterns for enums.

Report:
- migration filename
- tables/columns added
- any code in `services/` or `lib/` that should now consume the new schema
