alter table public.trip_items
add column if not exists item_kind text not null default 'task';

alter table public.trip_items
drop constraint if exists trip_items_item_kind_check;

alter table public.trip_items
add constraint trip_items_item_kind_check
check (item_kind in ('task', 'decision'));

update public.trip_items
set item_kind = 'decision'
where stage in ('pending', 'confirmed')
   or title ilike 'choose %';
