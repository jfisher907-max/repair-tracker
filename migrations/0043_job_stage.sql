-- A job has a stage now: scheduled, in progress, or done.
--
-- The owner's ask (2026-09-12): "I have quotes for pre-job status, then I
-- have jobs once the quote is approved and invoices once the job is finished
-- and then paid. Would it close the gap if we added a step for scheduled
-- jobs? That way the jobs aren't just in limbo once they're approved." And:
-- "J014, J012 and J011 have not been started yet, they're just on the
-- schedule waiting for the customer to drop off their car."
--
-- Until now a job carried only a payment status, so "unpaid" meant both "not
-- started" and "done, not billed": the dashboard counted those three booked
-- jobs ($1,038.09) as owed and as earned, and listed them under "To invoice".
--
-- The stage is the shop's view of the work; the money statuses (unpaid /
-- partial / paid, invoices) are unchanged and apply to DONE jobs:
--
--   scheduled    approved and booked, not started. jobs.date is the booked date.
--   in_progress  on the lift.
--   done         work complete, ready to bill.
--
-- Only done jobs count as work in the books (count, hours, billed, earned,
-- owed, "to invoice"). Cash stays cash: a deposit paid on a scheduled job and
-- parts bought for it count on the day the money moved (lib/finances.ts).
--
-- The DB default is 'done' because every row already here is finished work;
-- nothing relies on it — every INSERT passes stage explicitly: a hand-entered
-- job starts in_progress (JobForm), and a converted quote starts scheduled in
-- convert_quote_to_job itself (replaced below), which is the ONE automated
-- insert path — record_deposit_payment (0022, the Stripe deposit webhook)
-- calls it headless, so a customer paying a deposit online must land on a
-- SCHEDULED job with its deposit held, never on a "done" job with a partial
-- payment. Customer-facing pages never read this column.

alter table public.jobs
  add column if not exists stage text not null default 'done'
    check (stage in ('scheduled', 'in_progress', 'done'));

alter table public.jobs
  add column if not exists stage_changed_at timestamptz null;

comment on column public.jobs.stage is
  'scheduled (approved and booked, not started; date is the booked date) | in_progress (on the lift) | done (work complete, ready to bill). Only done jobs count as work in the books; payment_status applies to done jobs. Default done for the pre-0043 rows; the app always sets it explicitly.';

comment on column public.jobs.stage_changed_at is
  'When stage last changed (set by the stage control and by the invoice gate). Null on rows that predate 0043.';

-- ---------------------------------------------------------------------------
-- Backfill: the three jobs the owner named are booked, not started. Nothing
-- else changes. Guarded on stage = 'done' so a re-run is a no-op and a job
-- already moved by hand is not moved back.
-- ---------------------------------------------------------------------------

update public.jobs
   set stage = 'scheduled',
       stage_changed_at = now()
 where job_number in ('J011', 'J012', 'J014')
   and deleted_at is null
   and stage = 'done';

-- ----------------------------------------------------- convert_quote_to_job
-- The 0030 body unchanged except the jobs insert, which now stamps the stage:
-- the job a quote turns into is SCHEDULED (approved, booked, not started) the
-- moment it exists, on the owner's tap and on the deposit webhook alike. The
-- quote page then sets only the booked date the owner picked. Still SECURITY
-- INVOKER, still idempotent, still callable headless by record_deposit_payment.
-- The 0018 grants are restated so a fresh database gets the same surface.

create or replace function public.convert_quote_to_job(p_quote_id uuid) returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_quote record;
  v_job   uuid;
begin
  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote not found';
  end if;
  if v_quote.job_id is not null then
    return v_quote.job_id;
  end if;
  if v_quote.vehicle_id is null then
    raise exception 'set a vehicle on this quote first — jobs are always tied to a vehicle';
  end if;

  insert into jobs (vehicle_id, date, title, work_performed, labor_hours, labor_rate_cents, notes,
                    stage, stage_changed_at)
  values (v_quote.vehicle_id, shop_today(), v_quote.title, v_quote.description,
          v_quote.labor_hours, v_quote.labor_rate_cents,
          'From quote ' || v_quote.quote_number,
          'scheduled', now())
  returning id into v_job;

  insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents,
                          quote_line_id, awaiting_cost)
  select v_job, l.description, l.qty, 0, l.unit_charge_cents, l.id, true
    from quote_lines l
   where l.quote_id = p_quote_id and not l.declined
   order by l.created_at;

  insert into recommendations (job_id, vehicle_id, description, estimate_cents, status)
  select v_job, v_quote.vehicle_id,
         l.description || ' (declined on ' || v_quote.quote_number || ')',
         l.line_total_cents, 'open'
    from quote_lines l
   where l.quote_id = p_quote_id and l.declined
   order by l.created_at;

  update quotes
     set job_id = v_job, applied_at = now()
   where id = p_quote_id;

  return v_job;
end;
$$;

revoke all on function public.convert_quote_to_job(uuid) from public;
revoke all on function public.convert_quote_to_job(uuid) from anon;
grant execute on function public.convert_quote_to_job(uuid) to authenticated;
grant execute on function public.convert_quote_to_job(uuid) to service_role;

-- Verify after applying (read-only): the live body inserts scheduled.
--
--   select position('''scheduled'', now()' in
--            pg_get_functiondef('public.convert_quote_to_job(uuid)'::regprocedure)) > 0;
--
-- Undo (the three go back to done; the columns stay — dropping them would
-- break the app's select('*') readers and the reports export; the function
-- goes back to the 0030 body):
--
--   update public.jobs
--      set stage = 'done', stage_changed_at = null
--    where job_number in ('J011', 'J012', 'J014');
--
-- Full removal, only if nothing reads the columns any more:
--
--   alter table public.jobs drop column stage_changed_at;
--   alter table public.jobs drop column stage;
