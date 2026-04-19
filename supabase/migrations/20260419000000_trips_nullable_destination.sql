-- Starting a trip no longer requires a destination up-front: it can be
-- decided later alongside dates and participants.
alter table trips
  alter column destination_name drop not null;
