alter table trips
  add column if not exists destination_formatted_address text,
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision,
  add column if not exists destination_google_maps_url text,
  add column if not exists destination_photo_name text,
  add column if not exists destination_timezone text,
  add column if not exists destination_source_last_synced_at timestamptz;

create index if not exists trips_destination_place_id_idx
  on trips (destination_place_id)
  where destination_place_id is not null;

create index if not exists trips_destination_lat_lng_idx
  on trips (destination_lat, destination_lng)
  where destination_lat is not null and destination_lng is not null;

create index if not exists trips_destination_timezone_idx
  on trips (destination_timezone)
  where destination_timezone is not null;
