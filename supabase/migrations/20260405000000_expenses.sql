-- ─────────────────────────────────────────────────────────────────────────────
-- TravelSync AI — Expense Tracking
-- Migration: 20260405000000_expenses
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── expenses ─────────────────────────────────────────────────────────────────
-- One row per payment made by a group member.

create table expenses (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references line_groups (id) on delete cascade,
  trip_id               uuid references trips (id) on delete set null,
  paid_by_user_id       text not null,
  paid_by_display_name  text,
  amount                numeric(10, 2) not null check (amount > 0),
  description           text not null,
  created_at            timestamptz not null default now()
);

create index expenses_group_id_idx on expenses (group_id);
create index expenses_trip_id_idx  on expenses (trip_id);

-- ─── expense_splits ───────────────────────────────────────────────────────────
-- One row per beneficiary of an expense.
-- share_amount is each person's portion (sum of splits = expense.amount).

create table expense_splits (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references expenses (id) on delete cascade,
  user_id       text not null,
  display_name  text not null,
  share_amount  numeric(10, 2) not null check (share_amount > 0),
  created_at    timestamptz not null default now()
);

create index expense_splits_expense_id_idx on expense_splits (expense_id);
create index expense_splits_user_id_idx    on expense_splits (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Admin client (service role) bypasses RLS — these policies guard the anon key.

alter table expenses       enable row level security;
alter table expense_splits enable row level security;

-- No public access; all writes go through the server-side admin client.
create policy "no anon access" on expenses       for all using (false);
create policy "no anon access" on expense_splits for all using (false);
