-- Add booking lifecycle tracking to trip_items.
--
-- Rationale: the `confirmed` stage records that the group voted for an option,
-- but does not track whether an actual booking was made. This migration adds a
-- booking_status column so the system can distinguish:
--   not_required – no booking action needed (e.g. picking a meeting point)
--   needed       – confirmed by vote but booking not yet completed
--   booked       – booking completed and confirmation reference attached
--
-- Backward compatibility: existing rows default to 'not_required' so nothing
-- appears broken on already-shipped trips. New trips will have booking_status
-- set to 'needed' automatically on vote confirmation for bookable item types.

alter table public.trip_items
  add column if not exists booking_status text not null default 'not_required';

alter table public.trip_items
  drop constraint if exists trip_items_booking_status_check;

alter table public.trip_items
  add constraint trip_items_booking_status_check
  check (booking_status in ('not_required', 'needed', 'booked'));

alter table public.trip_items
  add column if not exists booking_ref text;

alter table public.trip_items
  add column if not exists booked_by_line_user_id text;

alter table public.trip_items
  add column if not exists booked_at timestamptz;
