-- Add budget columns to trips
-- budget_amount: planned total spend (null = unset)
-- budget_currency: ISO 4217 code, defaults to TWD
alter table trips
  add column budget_amount  numeric(12,2),
  add column budget_currency text not null default 'TWD';
