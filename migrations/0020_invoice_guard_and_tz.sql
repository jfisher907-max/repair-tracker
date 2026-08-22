-- Two review hardenings for the deposits money core.
--
-- 1. At most one live invoice per job. The paid-to-date rule credits every
--    payment on a job to each of its live invoices — correct because invoices
--    are whole-job revisions, but it depends on there never being two live at
--    once. createInvoice enforces that in the client; this makes the database
--    the real guard, so a race or a future code path can't create a second
--    live invoice and double-count the job as paid. (Verified 0 existing
--    violations before adding.)
--
-- 2. paid_at is anchored to UTC, matching the TS mirror's `${date}T00:00:00Z`
--    write, so the settle timestamp is identical no matter the DB session
--    timezone, and the public invoice's paid date reads the same as the
--    owner page's.

-- NOTE: reverted in 0021 — this proved too strict (a PAID invoice counts as
-- live under `status <> 'void'`, which blocked the legitimate add-on-after-paid
-- reissue). Kept here as applied history; see 0021 for the drop and rationale.
create unique index if not exists invoices_one_live_per_job
  on public.invoices (job_id)
  where status <> 'void';

create or replace function public.refresh_job_payment_cache(p_job_id uuid) returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_paid   integer;
  v_target integer;
  v_status text;
  v_inv    record;
  v_last   date;
begin
  select coalesce(sum(amount_cents), 0), max(date) into v_paid, v_last
    from payments where job_id = p_job_id;

  select greatest(
           coalesce((select total_charged_cents from job_totals where job_id = p_job_id), 0),
           coalesce((select max(total_cents) from invoices
                      where job_id = p_job_id and status <> 'void'), 0))
    into v_target;

  v_status := case
                when v_paid <= 0 then 'unpaid'
                when v_target > 0 and v_paid >= v_target then 'paid'
                else 'partial'
              end;

  update jobs
     set payment_status    = v_status,
         amount_paid_cents = nullif(v_paid, 0)
   where id = p_job_id;

  for v_inv in
    select id, total_cents, status, sent_at from invoices
     where job_id = p_job_id and status <> 'void'
  loop
    if v_inv.total_cents > 0 and v_paid >= v_inv.total_cents then
      if v_inv.status <> 'paid' then
        -- UTC-anchored to match the TS mirror's `${date}T00:00:00Z`.
        update invoices
           set status = 'paid',
               paid_at = coalesce((v_last::timestamp at time zone 'UTC'), now())
         where id = v_inv.id;
      end if;
    elsif v_inv.status = 'paid' then
      update invoices
         set status  = case when v_inv.sent_at is null then 'draft' else 'sent' end,
             paid_at = null
       where id = v_inv.id;
    end if;
  end loop;
end;
$$;

create or replace function public.get_public_invoice(token uuid) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number,
    'status', i.status,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'customer_name', i.customer_name,
    'vehicle_label', i.vehicle_label,
    'job_title', i.job_title,
    'work_performed', i.work_performed,
    'lines', i.lines,
    'labor_hours', i.labor_hours,
    'labor_rate_cents', i.labor_rate_cents,
    'labor_cents', i.labor_cents,
    'parts_cents', i.parts_cents,
    'tax_rate_bp', i.tax_rate_bp,
    'tax_cents', i.tax_cents,
    'total_cents', i.total_cents,
    'amount_paid_cents', invoice_paid_cents(i.id),
    'memo', i.memo,
    'paid_at', (i.paid_at at time zone 'UTC')::date,
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email,
        'payment_instructions', s.invoice_payment_instructions
      ) from public.settings s limit 1
    )
  )
  from public.invoices i
  where i.public_token = token and i.status <> 'void'
$$;
