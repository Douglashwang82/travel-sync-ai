-- Add opt-out support to group_members.
-- optout_at: set when user runs /optout, cleared on /optin.

alter table group_members
  add column if not exists optout_at timestamptz;

create index group_members_optout_idx on group_members (optout_at)
  where optout_at is not null;
