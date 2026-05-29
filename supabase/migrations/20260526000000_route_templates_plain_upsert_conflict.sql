-- Supabase/PostgREST upserts use `onConflict: "destination_name,title"` in
-- the route seeders and notebook pre-flight cells. The original uniqueness
-- guard is an expression index on lower(destination_name), lower(title), which
-- prevents case-only duplicates but cannot satisfy `ON CONFLICT
-- (destination_name, title)`.
--
-- Keep the expression index for case-insensitive protection and add a plain
-- column unique index so PostgREST can target the existing upsert contract.
create unique index if not exists route_templates_destination_title_plain_uniq
  on route_templates (destination_name, title);
