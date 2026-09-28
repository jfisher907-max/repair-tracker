-- 0053: a record of tax returns filed and tax paid, and the sales-tax basis.
--
-- The owner (2026-09-27): "I also want to see if we can add a type of system
-- that allows me to be as prepared as possible for filing taxes (in system
-- reminders for due dates, total amount due, etc.)". Phase 0 of that plan is
-- ready before his first City and Borough of Juneau sales-tax return: Q3 2026
-- (July-September), officially due Sat Oct 31, 2026, which the city moves to
-- Mon Nov 2 because it falls on a weekend.
--
-- WHAT THIS ADDS
--
--   public.tax_filings - one row per return filed and/or payment made. The
--   app never files or pays anything; the owner files on the city's site and
--   records here what he did. The Taxes page writes these rows; the dashboard's
--   Taxes door goes away once a period is recorded as filed and paid; the money
--   ledger's "Sales tax held for the state" nets down by the cbj_sales_tax
--   amounts recorded as paid (a separate row, so the column still adds).
--
--     obligation    what was filed/paid:
--                     cbj_sales_tax     Juneau quarterly sales-tax return
--                     federal_estimate  IRS estimated tax (Form 1040-ES)
--                     cbj_property      Juneau business property return / tax
--                     other             anything else (note says what)
--     period_start  first day of the period the filing covers (a quarter for
--     period_end    cbj_sales_tax); period_end >= period_start
--     due_date      the official due date, as the owner or the app saw it
--     filed_on      the day the return was filed (null = not filed yet)
--     paid_on       the day the money left (null = not paid yet)
--     amount_cents  what was paid, integer cents, >= 0 (0 = a no-sales return)
--     settles_return  the owner says this payment was the FULL amount the
--                   city asked for, although it is less than the app's figure
--                   (a rounding difference, or the city's own number). A
--                   quarter counts as paid only when the payments recorded
--                   for EXACTLY that period reach the app's tax, or one of
--                   them carries this flag; a short or mistyped payment
--                   never switches the reminder off by itself.
--     method        ach | card | check | cash | other (null until paid)
--     confirmation  the city's or the IRS's confirmation number
--     note          free text (late fees go here, not in amount_cents)
--
--   public.settings.sales_tax_basis - 'cash' or 'accrual', the basis the city
--   requires to match the owner's federal return. NULL = not chosen yet
--   (decision TAX-1 on his sheet), and the Taxes page shows both side by side
--   until it is set.
--
-- SECURITY: the house owner-only pattern (0048 tips): RLS on, one owner_all
-- policy for authenticated on public.is_owner(), and anon and PUBLIC revoked
-- so no default grant can reach it. Nothing here is customer-facing; no public
-- RPC reads it.
--
-- REVERSIBLE: purely additive. Undo at the bottom.

create table if not exists public.tax_filings (
  id            uuid primary key default gen_random_uuid(),
  obligation    text not null,
  period_start  date not null,
  period_end    date not null,
  due_date      date,
  filed_on      date,
  paid_on       date,
  amount_cents  integer not null default 0 check (amount_cents >= 0),
  settles_return boolean not null default false,
  method        text,
  confirmation  text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tax_filings_obligation_check
    check (obligation = any (array['cbj_sales_tax'::text, 'federal_estimate'::text, 'cbj_property'::text, 'other'::text])),
  -- NULL passes a CHECK, and null is allowed here on purpose (not paid yet).
  constraint tax_filings_method_check
    check (method is null or method = any (array['ach'::text, 'card'::text, 'check'::text, 'cash'::text, 'other'::text])),
  constraint tax_filings_period_check
    check (period_end >= period_start)
);

comment on table public.tax_filings is
  'Tax returns the owner filed and tax he paid, as he recorded them. The app never files or pays; it reads these to turn the dashboard reminder off and to net sales tax held down by what was paid. 0053.';

create index if not exists tax_filings_obligation_period_idx
  on public.tax_filings (obligation, period_start);

drop trigger if exists tax_filings_updated_at on public.tax_filings;
create trigger tax_filings_updated_at
  before update on public.tax_filings
  for each row execute function public.set_updated_at();

alter table public.tax_filings enable row level security;
drop policy if exists owner_all on public.tax_filings;
create policy owner_all on public.tax_filings
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.tax_filings from anon;
revoke all on public.tax_filings from public;

-- ------------------------------------------------ settings.sales_tax_basis

alter table public.settings
  add column if not exists sales_tax_basis text;

alter table public.settings
  drop constraint if exists settings_sales_tax_basis_check;
alter table public.settings
  add constraint settings_sales_tax_basis_check
  check (sales_tax_basis is null or sales_tax_basis = any (array['cash'::text, 'accrual'::text]));

comment on column public.settings.sales_tax_basis is
  'cash or accrual: the basis for the Juneau sales-tax return, which must match the owner''s federal return. NULL = not chosen yet; the Taxes page shows both. 0053.';

-- Verify after applying (read-only):
--
--   select relrowsecurity from pg_class where oid = 'public.tax_filings'::regclass;          -- true
--   select policyname, roles, cmd, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename = 'tax_filings';                              -- owner_all, {authenticated}, ALL, is_owner()
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'tax_filings'
--      and grantee in ('anon', 'PUBLIC');                                                    -- no rows
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.tax_filings'::regclass and contype = 'c' order by conname;    -- method, obligation, period, amount checks
--   select indexname from pg_indexes where tablename = 'tax_filings';                       -- pkey + tax_filings_obligation_period_idx
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'tax_filings' and column_name = 'settles_return'; -- boolean, NO, false
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'settings' and column_name = 'sales_tax_basis'; -- text, YES
--   select sales_tax_basis from public.settings;                                            -- null (not chosen yet)
--
-- UNDO (loses any filings recorded since):
--   drop table if exists public.tax_filings;
--   alter table public.settings drop constraint if exists settings_sales_tax_basis_check;
--   alter table public.settings drop column if exists sales_tax_basis;
