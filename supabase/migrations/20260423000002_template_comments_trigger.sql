-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Template comment_count trigger
-- Migration: 20260423000002_template_comments_trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Keeps trip_templates.comment_count in sync with non-deleted comment rows.
-- Handles three transitions:
--   INSERT with deleted_at null      →  +1
--   DELETE of a non-deleted row      →  -1
--   UPDATE null -> non-null          →  -1   (soft-delete)
--   UPDATE non-null -> null          →  +1   (undelete)

create or replace function update_template_comment_count()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if new.deleted_at is null then
      update trip_templates
         set comment_count = comment_count + 1
       where id = new.template_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.deleted_at is null then
      update trip_templates
         set comment_count = greatest(0, comment_count - 1)
       where id = old.template_id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      update trip_templates
         set comment_count = greatest(0, comment_count - 1)
       where id = new.template_id;
    elsif old.deleted_at is not null and new.deleted_at is null then
      update trip_templates
         set comment_count = comment_count + 1
       where id = new.template_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger template_comments_count_trigger
  after insert or update or delete on template_comments
  for each row execute function update_template_comment_count();
