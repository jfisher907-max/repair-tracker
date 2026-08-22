-- The one "paid to date" rule + hardening of the card-payment recorder.
--
-- Every invoice snapshots the WHOLE job, so invoices are revisions of one
-- debt, never installments. Money on a job therefore belongs to the live
-- invoice unless it was explicitly taken against a DIFFERENT live invoice.
-- That covers a deposit paid on the quote (invoice_id null, see 0018), a
-- "Mark paid" tapped before the invoice existed, and a payment taken against
-- an invoice that was later voided and reissued — all of which used to vanish
-- from the customer's balance and could be charged twice.
--
-- record_card_payment also summed a job's invoices to decide "paid" (the
-- J006 bug, fixed in the app but not here) and could flip a voided invoice
-- to paid. Both fixed; the job-cache math now lives in one SQL function that
-- mirrors lib/payments.ts syncJobPayment.

-- ---------------------------------------------------------------------------
-- Shop-local "today". Postgres runs in UTC; a card paid at 9 pm in Anchorage
-- must not be booked tomorrow.
-- ---------------------------------------------------------------------------

create or replace function public.shop_today() returns date
language sql stable
as $$ select (now() at time zone 'America/Anchorage')::date $$;

-- ---------------------------------------------------------------------------
-- The paid-to-date rule, defined once.
-- ---------------------------------------------------------------------------

create or replace function public.invoice_paid_cents(p_invoice_id uuid) returns integer
language sql stable security invoker
set search_path = public
as $$
  select coalesce(sum(p.amount_cents), 0)::integer
    from invoices x
    join payments p on p.job_id = x.job_id
   where x.id = p_invoice_id
     and (p.invoice_id is null
          or p.invoice_id = x.id
          or not exists (select 1 from invoices o
                          where o.id = p.invoice_id and o.status <> 'void'))
$$;

comment on function public.invoice_paid_cents(uuid) is
  'Payments on the invoice''s job not claimed by a DIFFERENT live invoice. Mirrored in lib/payments.ts invoicePaidCents — keep them identical.';

-- Re-derive the job's cached payment fields and settle/unsettle its invoices
-- from the ledger. Mirrors lib/payments.ts syncJobPayment exactly; used by the
-- server-side recorders so a webhook cannot drift from what the app computes.
create or replace function public.refresh_job_payment_cache(p_job_id uuid) returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_paid   integer;
  v_target integer;
  v_status text;
  v_inv    record;
  v_cover  integer;
  v_last   date;
begin
  select coalesce(sum(amount_cents), 0) into v_paid
    from payments where job_id = p_job_id;

  -- Owed is the greater of the job's charge math and its LARGEST live
  -- invoice: invoices are revisions of one debt, never installments, so they
  -- are never summed (summing stranded a fully paid job at "partial").
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
    v_cover := invoice_paid_cents(v_inv.id);
    if v_inv.total_cents > 0 and v_cover >= v_inv.total_cents then
      if v_inv.status <> 'paid' then
        select max(p.date) into v_last
          from payments p
         where p.job_id = p_job_id
           and (p.invoice_id is null or p.invoice_id = v_inv.id
                or not exists (select 1 from invoices o
                                where o.id = p.invoice_id and o.status <> 'void'));
        update invoices
           set status  = 'paid',
               paid_at = coalesce(v_last::timestamptz, now())
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

-- ---------------------------------------------------------------------------
-- Public invoice: the customer's balance now follows the rule.
-- ---------------------------------------------------------------------------

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
    'paid_at', i.paid_at::date,
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

-- ---------------------------------------------------------------------------
-- Card payment on an invoice (webhook) — hardened.
-- ---------------------------------------------------------------------------

create or replace function public.record_card_payment(
  p_token         uuid,
  p_external_ref  text,
  p_amount_cents  integer,
  p_fee_cents     integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount');
  end if;
  if p_external_ref is null or length(trim(p_external_ref)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing reference');
  end if;

  select i.id, i.job_id, i.invoice_number, i.status
    into v_inv
    from invoices i
   where i.public_token = p_token
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown invoice');
  end if;

  -- Stripe retries webhooks; the same charge must never post twice.
  if exists (select 1 from payments where external_ref = p_external_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_inv.job_id);
  end if;

  -- Real money is always recorded. If the invoice was voided while the
  -- customer was on Stripe's page, the payment is booked to the JOB
  -- (invoice_id null) so the rule carries it to the reissued invoice.
  insert into payments (job_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_inv.job_id,
          case when v_inv.status = 'void' then null else v_inv.id end,
          shop_today(), 'card', p_amount_cents,
          case when v_inv.status = 'void'
               then 'Paid online by card (against voided ' || v_inv.invoice_number || ')'
               else 'Paid online by card' end,
          p_external_ref);

  perform refresh_job_payment_cache(v_inv.job_id);

  -- The processing fee is a real cost of the sale; booking it keeps the P&L
  -- honest, since Stripe deposits net but the ledger records gross.
  if p_fee_cents is not null and p_fee_cents > 0 then
    insert into expenses (date, category, vendor, description, amount_cents)
    values (shop_today(), 'Software & fees', 'Stripe',
            'Card processing fee — ' || coalesce(v_inv.invoice_number, 'invoice'),
            p_fee_cents);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_inv.job_id);
end;
$$;

revoke all on function public.record_card_payment(uuid, text, integer, integer) from public;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from anon;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from authenticated;
grant execute on function public.record_card_payment(uuid, text, integer, integer) to service_role;
