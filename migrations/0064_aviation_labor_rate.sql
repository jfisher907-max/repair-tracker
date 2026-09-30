-- 0064: a separate labor rate for aircraft work.
--
-- Owner, 2026-09-30: "can you also change the labor rate for aviation to
-- $175/hr". settings.default_labor_rate_cents stays the car rate; new aircraft
-- jobs and quotes (vehicles.service_line = 'aviation', 0055) start at this one.
-- NULL = no separate rate: aircraft work starts at the car rate, as before.
-- Existing jobs, quotes and invoices keep the rate they already carry.
alter table public.settings
  add column if not exists aviation_labor_rate_cents integer;
alter table public.settings drop constraint if exists settings_aviation_labor_rate_check;
alter table public.settings add constraint settings_aviation_labor_rate_check
  check (aviation_labor_rate_cents is null or aviation_labor_rate_cents >= 0);
comment on column public.settings.aviation_labor_rate_cents is
  'Default labor rate for aircraft jobs and quotes, in cents per hour. NULL = use default_labor_rate_cents. 0064.';
-- House lines (0054): logged-out visitors hold nothing on the new column.
revoke all (aviation_labor_rate_cents) on public.settings from anon;
revoke all (aviation_labor_rate_cents) on public.settings from public;

-- The owner's rate.
update public.settings set aviation_labor_rate_cents = 17500 where id = 1;

-- PROOF (read-only): select default_labor_rate_cents, aviation_labor_rate_cents from public.settings;  -- 9000, 17500
--   select has_column_privilege('anon', 'public.settings', 'aviation_labor_rate_cents', 'SELECT,UPDATE'); -- false
-- UNDO: alter table public.settings drop column if exists aviation_labor_rate_cents;
