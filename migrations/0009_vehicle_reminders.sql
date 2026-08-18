-- Mileage-projected service reminders.
--
-- The paid CRM products guess ~33 miles/day when they don't know better. This
-- shop knows better: every job stores an odometer reading and a date, so a
-- vehicle with two visits yields its OWN miles/day, and "next oil change in
-- 5,000 miles" becomes an actual calendar date for that customer.
--
-- A reminder is interval work the owner chooses to define per vehicle — oil,
-- rotation, coolant — with when it was last done. Due date is the earlier of
-- the mileage projection and the calendar interval. Surfaced on Follow-ups
-- when it comes close, next to the other work worth a text message.

create table if not exists public.vehicle_reminders (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  name            text not null,
  interval_miles  integer,
  interval_months integer,
  last_done_date  date not null,
  last_done_miles integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A reminder with neither interval can never come due.
  constraint vehicle_reminders_has_interval
    check (interval_miles is not null or interval_months is not null)
);

create index if not exists vehicle_reminders_vehicle_idx on public.vehicle_reminders (vehicle_id);

alter table public.vehicle_reminders enable row level security;

drop policy if exists owner_all on public.vehicle_reminders;
create policy owner_all on public.vehicle_reminders for all using (is_owner()) with check (is_owner());

drop trigger if exists vehicle_reminders_updated_at on public.vehicle_reminders;
create trigger vehicle_reminders_updated_at
  before update on public.vehicle_reminders
  for each row execute function set_updated_at();
