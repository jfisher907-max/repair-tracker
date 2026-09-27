-- 0048: a tip is its own money — not a payment on the job, not a sale.
--
-- The owner (2026-09-27): "J011 is a tip." J011's customer paid $240.00 cash
-- against INV-018, a $231.00 invoice ($220.00 + $11.00 sales tax). The $9.00
-- over the bill was recorded as part of the payment, so the books read it as
-- "collected over the invoice; a tip, or owed back".
--
-- Why a separate table and not a payment with a note:
--   * A payment settles the job. Every surface that asks "what is owed" or "is
--     it paid" (refresh_job_payment_cache, invoice_paid_cents, syncJobPayment,
--     owedGrossCents, the statement) sums payments, and a tip must never count
--     toward a bill or hide a balance.
--   * Sales tax is prorated against payments (lib/finances.ts). A voluntary
--     tip is NOT taxable in Juneau (CBJ Administrative Guidelines, 69.05.010
--     Definitions, "Gratuities", (a) Voluntary Tips: a tip given without
--     being prompted "is not taxable"), so it must stay out of that base —
--     and out of Reports' Sales column, which reads invoices only. A tip the
--     shop PUTS on the bill as mandatory would be taxable under (c); this
--     table is for the voluntary kind only.
--   * It IS income and it IS cash: it counts in cash in and cash profit, by
--     its own date, and nowhere in charged / earned / unpaid / collected on
--     the work.
--
-- The table mirrors payments' shape where it overlaps: method is the same
-- domain (payments_method_check: cash, check, venmo, card, other), same
-- default; date is the day the money moved. RLS: the house owner_all policy
-- on is_owner(), anon has nothing (the job_authorizations pattern, 0032), and
-- PUBLIC is revoked as well so no default grant can reach it. Tips on a
-- deleted job cascade away with a hard delete; a soft-deleted job's tips are
-- filtered out by the app the same way its payments are.
--
-- J011's move is GUARDED. It runs only if J011 exists once, is not deleted,
-- has exactly ONE payment and that payment is 24000 cents, its governing live
-- invoice (largest non-void, ties to newest) totals 23100, and it has no tip
-- yet. Otherwise the move is refused and nothing in it is written.
--
-- THE TABLE LANDS EITHER WAY. The new code reads tips unconditionally
-- (lib/finances.ts throws on an error from it, so the dashboard, Billing,
-- Reports and the export all break without the table). The move therefore
-- runs in its own inner block with an EXCEPTION handler, which Postgres runs
-- as a savepoint: a refusal (or any error in the move) rolls back only the
-- move's own writes, raises a WARNING naming the reason, and the migration
-- still commits the table, index, RLS and revokes. So a refused move shows
-- up as a WARNING, not a failed migration — the verify query below is how
-- to tell (J011 still one payment of 24000, no tip). A re-run after a
-- successful move warns "payment is 23100 cents, expected 24000" and changes
-- nothing.
-- Then: the payment becomes 23100, a 900-cent tip is inserted with the
-- payment's date and method and the note 'Tip', and refresh_job_payment_cache
-- re-derives J011's cached status. The job must still read 'paid' (23100 ≥
-- greatest(job charge 22000, invoice 23100)) — checked, and refused if not.
-- INV-018 stays 'paid' (23100 ≥ 23100), so the cache function does not write
-- to it; its included_tax_cents is 0 and frozen either way (0047).

create table if not exists public.tips (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  method       text not null default 'cash',
  date         date not null,
  note         text,
  created_at   timestamptz not null default now(),
  constraint tips_method_check
    check (method = any (array['cash'::text, 'check'::text, 'venmo'::text, 'card'::text, 'other'::text]))
);

comment on table public.tips is
  'A tip on a job: income and cash on its own date, never a payment toward the job, never part of the sale and never in the sales-tax base (a voluntary gratuity is not taxable in Juneau). One row per tip. 0048.';

create index if not exists tips_job_idx on public.tips (job_id);

alter table public.tips enable row level security;
drop policy if exists owner_all on public.tips;
create policy owner_all on public.tips
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.tips from anon;
revoke all on public.tips from public;

-- ---------------------------------------------------------------- J011's tip

do $$
declare
  v_jobs       integer;
  v_job        uuid;
  v_pay_count  integer;
  v_pay_id     uuid;
  v_pay_amount integer;
  v_pay_date   date;
  v_pay_method text;
  v_gov_total  integer;
  v_status     text;
begin
  -- Inner block = savepoint: a refusal below undoes only the move, never the
  -- table above (see the header).
  begin
  select count(*) into v_jobs
    from public.jobs where job_number = 'J011' and deleted_at is null;
  if v_jobs <> 1 then
    raise exception '0048 refused: expected exactly one live J011, found %. Nothing was changed.', v_jobs;
  end if;
  select id into v_job from public.jobs where job_number = 'J011' and deleted_at is null;

  select count(*) into v_pay_count from public.payments where job_id = v_job;
  if v_pay_count <> 1 then
    raise exception '0048 refused: J011 has % payments, expected exactly 1. Nothing was changed.', v_pay_count;
  end if;
  select id, amount_cents, date, method
    into v_pay_id, v_pay_amount, v_pay_date, v_pay_method
    from public.payments where job_id = v_job;
  if v_pay_amount <> 24000 then
    raise exception '0048 refused: J011''s payment is % cents, expected 24000. Nothing was changed.', v_pay_amount;
  end if;

  select i.total_cents into v_gov_total
    from public.invoices i
   where i.job_id = v_job and i.status <> 'void'
   order by i.total_cents desc, i.created_at desc
   limit 1;
  if v_gov_total is distinct from 23100 then
    raise exception '0048 refused: J011''s governing invoice total is %, expected 23100. Nothing was changed.', v_gov_total;
  end if;

  if exists (select 1 from public.tips where job_id = v_job) then
    raise exception '0048 refused: J011 already has a tip. Nothing was changed.';
  end if;

  update public.payments set amount_cents = 23100 where id = v_pay_id;

  insert into public.tips (job_id, amount_cents, method, date, note)
  values (v_job, 900, v_pay_method, v_pay_date, 'Tip');

  perform public.refresh_job_payment_cache(v_job);

  select payment_status into v_status from public.jobs where id = v_job;
  if v_status is distinct from 'paid' then
    raise exception '0048 refused: after the move J011 reads %, not paid. Rolled back.', v_status;
  end if;
  exception when others then
    raise warning '% — the tips table was created; J011''s payment and tips are exactly as before. Check J011 by hand and record any tip on its job page.', sqlerrm;
  end;
end
$$;

-- Verify after applying (read-only; expect payment 23100, one tip of 900 cash
-- on 2026-09-15 noted Tip, job paid with amount_paid_cents 23100, INV-018 paid):
--
--   select j.job_number, j.payment_status, j.amount_paid_cents,
--          (select json_agg(json_build_object('amt', p.amount_cents, 'date', p.date, 'method', p.method))
--             from public.payments p where p.job_id = j.id) as payments,
--          (select json_agg(json_build_object('amt', t.amount_cents, 'date', t.date, 'method', t.method, 'note', t.note))
--             from public.tips t where t.job_id = j.id) as tips,
--          (select status from public.invoices where invoice_number = 'INV-018') as inv018
--     from public.jobs j where j.job_number = 'J011';
--   select relrowsecurity from pg_class where oid = 'public.tips'::regclass;           -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'tips' and grantee in ('anon', 'PUBLIC'); -- no rows
--
-- UNDO (J011 back to one $240.00 payment; the table stays unless nothing reads it):
--   update public.payments set amount_cents = 24000
--    where job_id = (select id from public.jobs where job_number = 'J011') and amount_cents = 23100;
--   delete from public.tips
--    where job_id = (select id from public.jobs where job_number = 'J011') and amount_cents = 900;
--   select public.refresh_job_payment_cache((select id from public.jobs where job_number = 'J011'));
