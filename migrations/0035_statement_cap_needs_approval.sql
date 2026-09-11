-- 0035: the statement's approved-total cap must never fire without an approved total.
--
-- job_authorized_totals.checked goes true as soon as a quote has been APPLIED to
-- the job, but quoted_cents only sums quotes whose status is 'approved'. A job
-- converted from a quote that was never marked approved (the convert screen only
-- warns) therefore reads checked = true, quoted_cents = 0, authorized_cents = 0,
-- and get_public_statement capped that job at least(total_charged, 0) = 0. With
-- no invoice yet the customer's statement showed the job at nothing owed, and
-- app/s/[token] drops zero-balance items, so the job vanished from the statement
-- while the job page and lib/calc still showed the full balance owed.
--
-- This is the same shape as the 0033 bug (snapshot_pre_tax_cents returning 0 for
-- a missing snapshot, which briefly showed J003 at $0): cap only when there is a
-- real approved estimate to cap against. Guarding on quoted_cents rather than
-- authorized_cents matters too - a later "OK" delta recorded on a job that has no
-- approved estimate must not become the ceiling by itself.
--
-- Nothing else in the function changes.

create or replace function public.get_public_statement(token uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'customer_name', c.name,
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email,
        'payment_instructions', s.invoice_payment_instructions
      ) from public.settings s limit 1
    ),
    'items', (
      select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb) from (
        select jsonb_build_object(
          'job_number', j.job_number,
          'title', j.title,
          'date', j.date,
          'invoice_number', (
            select i.invoice_number from public.invoices i
            where i.job_id = j.id and i.status <> 'void'
            order by i.created_at desc limit 1
          ),
          'due_date', (
            select i.due_date from public.invoices i
            where i.job_id = j.id and i.status <> 'void'
            order by i.created_at desc limit 1
          ),
          'total_cents', greatest(
            case when a.checked and a.quoted_cents > 0
                 then least(t.total_charged_cents, a.authorized_cents)
                 else t.total_charged_cents end,
            coalesce((select max(i.total_cents) from public.invoices i
                      where i.job_id = j.id and i.status <> 'void'), 0)
          ),
          'paid_cents', coalesce(
            (select sum(p.amount_cents) from public.payments p where p.job_id = j.id),
            j.amount_paid_cents, 0
          )
        ) as item
        from public.jobs j
        join public.vehicles v on v.id = j.vehicle_id
        join public.job_totals t on t.job_id = j.id
        join public.job_authorized_totals a on a.job_id = j.id
        where v.customer_id = c.id and j.deleted_at is null and j.payment_status <> 'paid'
      ) sub
    )
  )
  from public.customers c
  where c.public_token = token and c.deleted_at is null
$function$;
