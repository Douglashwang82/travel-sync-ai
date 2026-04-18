-- travel_documents: track per-member documents for a trip
-- Covers passport, visa, insurance, and any other travel document.
create table travel_documents (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips (id) on delete cascade,
  group_id        uuid not null references line_groups (id) on delete cascade,
  line_user_id    text not null,
  display_name    text,
  doc_type        text not null,          -- passport | visa | insurance | other
  doc_label       text,                   -- e.g. "Japan e-Visa", "Travel insurance cert"
  expires_at      date,                   -- null = no expiry or unknown
  status          text not null default 'ok',  -- ok | expiring | expired | missing
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index travel_documents_trip_id_idx  on travel_documents (trip_id);
create index travel_documents_group_id_idx on travel_documents (group_id);
create index travel_documents_user_idx     on travel_documents (group_id, line_user_id);

alter table travel_documents enable row level security;
create policy "no anon access" on travel_documents for all to anon using (false);
