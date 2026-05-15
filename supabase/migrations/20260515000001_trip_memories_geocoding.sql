-- Add geocoded coordinates to trip_memories so shared content with an address
-- can be rendered as pins on the trip map alongside trip_item_options.
--
-- Memories are populated by /share and AI parsing — they hold an `address`
-- string but historically had no lat/lng. The map view only knows how to plot
-- coordinates, so addressable shared content was silently invisible.
--
-- Backfill is intentionally not run here: existing rows will be geocoded on
-- next mention via rememberPlace(), or by the dedicated backfill script.

alter table public.trip_memories
  add column if not exists lat double precision;

alter table public.trip_memories
  add column if not exists lng double precision;

create index if not exists trip_memories_lat_lng_idx
  on public.trip_memories (lat, lng)
  where lat is not null and lng is not null;
