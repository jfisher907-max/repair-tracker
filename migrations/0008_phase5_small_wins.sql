-- Phase 5: the small features that each close a real gap.
--
-- 1. Cores. A core charge is the shop's own money sitting on a shelf inside a
--    dirty old part — with no parts counter, the core nobody returns is cash
--    that walks away. Core-charge lines are already identifiable by
--    description; what's missing is knowing which ones came back.
-- 2. Warranty. When a comeback rolls in, the question is "am I eating this?"
--    — answered by two numbers on the original job.
-- 3. Promised date. "What did I promise this week, and to whom" — one date
--    field, no calendar theatre.
-- 4. Templates. A repeat brake job typed from scratch on a phone every time,
--    when the shop's own completed jobs already know the labor and the parts.

alter table public.part_lines
  add column if not exists core_returned_at timestamptz;

comment on column public.part_lines.core_returned_at is
  'For core-charge lines: when the old unit went back to the supplier. Null on a core line = still sitting in the shop.';

alter table public.jobs
  add column if not exists warranty_months integer,
  add column if not exists warranty_miles  integer,
  add column if not exists promised_date   date;

comment on column public.jobs.warranty_months is 'Shop warranty on this job''s parts and labor, in months. Null = none given.';
comment on column public.jobs.promised_date  is 'When the customer was told the vehicle would be ready.';

create table if not exists public.job_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  title        text not null,
  work_performed text,
  labor_hours  numeric not null default 0,
  -- [{description, qty, unit_charge_cents}] — charge side only; costs come
  -- from the real receipt when the parts are actually bought.
  lines        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.job_templates enable row level security;

drop policy if exists owner_all on public.job_templates;
create policy owner_all on public.job_templates for all using (is_owner()) with check (is_owner());

drop trigger if exists job_templates_updated_at on public.job_templates;
create trigger job_templates_updated_at
  before update on public.job_templates
  for each row execute function set_updated_at();
