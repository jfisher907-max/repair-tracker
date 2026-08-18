-- Online card payments (Stripe Checkout).
--
-- The webhook that records a payment is unauthenticated, so it must not be
-- able to touch anything but this one operation. Everything it needs lives in
-- a single SECURITY DEFINER function, executable only by service_role, which
-- mirrors lib/payments.ts syncJobPayment: the ledger is the source of truth
-- and jobs.payment_status / invoices.status are caches that follow it.

alter table public.payments
  add column if not exists external_ref text;

comment on column public.payments.external_ref is
  'Processor reference (Stripe PaymentIntent id). Unique — makes webhook retries idempotent.';

create unique index if not exists payments_external_ref_key
  on public.payments (external_ref)
  where external_ref is not null;

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
  v_inv      record;
  v_paid     integer;
  v_target   integer;
  v_inv_paid integer;
  v_status   text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount');
  end if;
  if p_external_ref is null or length(trim(p_external_ref)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing reference');
  end if;

  select i.id, i.job_id, i.invoice_number, i.total_cents, i.status
    into v_inv
    from invoices i
   where i.public_token = p_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown invoice');
  end if;

  -- Stripe retries webhooks; the same charge must never post twice.
  if exists (select 1 from payments where external_ref = p_external_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into payments (job_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_inv.job_id, v_inv.id, current_date, 'card', p_amount_cents,
          'Paid online by card', p_external_ref);

  select coalesce(sum(amount_cents), 0) into v_paid
    from payments where job_id = v_inv.job_id;

  -- Owed is the greater of the job's charge math and its open invoice totals:
  -- an invoice can add sales tax on top of the job total.
  select greatest(
           coalesce((select total_charged_cents from job_totals
                      where job_id = v_inv.job_id), 0),
           coalesce((select sum(total_cents) from invoices
                      where job_id = v_inv.job_id and status <> 'void'), 0))
    into v_target;

  v_status := case
                when v_paid <= 0 then 'unpaid'
                when v_target > 0 and v_paid >= v_target then 'paid'
                else 'partial'
              end;

  update jobs
     set payment_status    = v_status,
         amount_paid_cents = nullif(v_paid, 0)
   where id = v_inv.job_id;

  select coalesce(sum(amount_cents), 0) into v_inv_paid
    from payments where invoice_id = v_inv.id;

  if v_inv.total_cents > 0 and v_inv_paid >= v_inv.total_cents and v_inv.status <> 'paid' then
    update invoices set status = 'paid', paid_at = now() where id = v_inv.id;
  end if;

  -- The processing fee is a real cost of the sale; booking it keeps the P&L
  -- honest, since Stripe deposits net but the ledger records gross.
  if p_fee_cents is not null and p_fee_cents > 0 then
    insert into expenses (date, category, vendor, description, amount_cents)
    values (current_date, 'Software & fees', 'Stripe',
            'Card processing fee — ' || coalesce(v_inv.invoice_number, 'invoice'),
            p_fee_cents);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_inv.job_id);
end;
$$;

-- Only the server (service_role) may record a payment. Never anon: the invoice
-- token is shared with the customer, so an anon grant would let anyone holding
-- a link mark their own invoice paid.
revoke all on function public.record_card_payment(uuid, text, integer, integer) from public;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from anon;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from authenticated;
grant execute on function public.record_card_payment(uuid, text, integer, integer) to service_role;
