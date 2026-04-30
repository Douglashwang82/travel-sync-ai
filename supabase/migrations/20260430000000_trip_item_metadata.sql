-- Add type-specific metadata to trip_items.
--
-- Rationale: each item_type (hotel, restaurant, transport, flight, etc.) has
-- fields that don't belong on every row (check-in time, flight number, party
-- size, etc.). A jsonb column keeps the table schema stable while allowing
-- rich per-type detail validated at the application layer.
--
-- Backward compatibility: existing rows default to '{}' (empty object).
-- Application code treats '{}' as OtherMetadata with no extra fields.

alter table public.trip_items
  add column if not exists metadata jsonb not null default '{}';

comment on column public.trip_items.metadata is
  'Type-specific fields per item_type — schema validated in lib/trip-item-metadata.ts';
