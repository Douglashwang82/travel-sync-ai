-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Template like_count trigger
-- Migration: 20260423000001_template_likes_trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Keeps trip_templates.like_count in sync atomically.
-- Avoids the read-then-write race that an application-layer update would
-- have on concurrent likes.

create or replace function update_template_like_count()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    update trip_templates
       set like_count = like_count + 1
     where id = new.template_id;
  elsif TG_OP = 'DELETE' then
    update trip_templates
       set like_count = greatest(0, like_count - 1)
     where id = old.template_id;
  end if;
  return null;
end;
$$;

create trigger template_likes_count_trigger
  after insert or delete on template_likes
  for each row execute function update_template_like_count();
