-- Robust Stripe fee capture.
--
-- The processing fee is booked as a "Software & fees" expense so the P&L stays
-- on gross while Stripe deposits net. It was booked inline with the payment,
-- but two paths record a Checkout settlement — the webhook AND the customer's
-- return-from-Checkout reconciliation — and whichever lands first wins. If the
-- first one raced in before Stripe had computed the balance-transaction fee,
-- it recorded the payment with no fee, and the second saw a duplicate payment
-- and skipped everything, so the fee was lost.
--
-- Fix: book the fee on its OWN idempotency key (the Stripe reference), decoupled
-- from the payment's. Now whichever call first KNOWS the fee books it exactly
-- once, even if the payment row already exists from the other path.

alter table public.expenses
  add column if not exists external_ref text;

comment on column public.expenses.external_ref is
  'Processor reference (Stripe PaymentIntent id) for an auto-booked fee. Unique — makes fee capture idempotent across the webhook + return-reconciliation paths.';

create unique index if not exists expenses_external_ref_key
  on public.expenses (external_ref)
  where external_ref is not null;

-- Book a Stripe processing fee once per payment reference. Safe to call from
-- either recorder, on the fresh OR the duplicate path.
create or replace function public.book_stripe_fee(
  p_external_ref text,
  p_fee_cents    integer,
  p_label        text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_fee_cents is null or p_fee_cents <= 0 then
    return;
  end if;
  insert into expenses (date, category, vendor, description, amount_cents, external_ref)
  values (shop_today(), 'Software & fees', 'Stripe', p_label, p_fee_cents, p_external_ref)
  on conflict (external_ref) where external_ref is not null do nothing;
end;
$$;

-- Internal helper only: the definer recorders call it as the owner. Never
-- expose it — a direct grant would let a caller insert arbitrary expenses.
revoke all on function public.book_stripe_fee(text, integer, text) from public;
revoke all on function public.book_stripe_fee(text, integer, text) from anon;
revoke all on function public.book_stripe_fee(text, integer, text) from authenticated;

-- ---------------------------------------------------------------------------
-- Card payment on an invoice — fee booked idempotently, even on retry.
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

  -- Fee first, on its own idempotency key, so a duplicate-payment call from the
  -- other path can still backfill a fee the first call didn't have yet.
  perform book_stripe_fee(p_external_ref, p_fee_cents,
    'Card processing fee — ' || coalesce(v_inv.invoice_number, 'invoice'));

  if exists (select 1 from payments where external_ref = p_external_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_inv.job_id);
  end if;

  insert into payments (job_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_inv.job_id,
          case when v_inv.status = 'void' then null else v_inv.id end,
          shop_today(), 'card', p_amount_cents,
          case when v_inv.status = 'void'
               then 'Paid online by card (against voided ' || v_inv.invoice_number || ')'
               else 'Paid online by card' end,
          p_external_ref);

  perform refresh_job_payment_cache(v_inv.job_id);

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_inv.job_id);
end;
$$;

revoke all on function public.record_card_payment(uuid, text, integer, integer) from public;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from anon;
revoke all on function public.record_card_payment(uuid, text, integer, integer) from authenticated;
grant execute on function public.record_card_payment(uuid, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Deposit paid online — same idempotent fee handling.
-- ---------------------------------------------------------------------------

create or replace function public.record_deposit_payment(
  p_token           uuid,
  p_external_ref    text,
  p_amount_cents    integer,
  p_fee_cents       integer default null,
  p_opened_against  timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote record;
  v_job   uuid;
  v_note  text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount');
  end if;
  if p_external_ref is null or length(trim(p_external_ref)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing reference');
  end if;

  select q.id, q.job_id, q.quote_number, q.status, q.decided_at, q.vehicle_id
    into v_quote
    from quotes q
   where q.public_token = p_token
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown quote');
  end if;

  perform book_stripe_fee(p_external_ref, p_fee_cents,
    'Card processing fee — deposit ' || v_quote.quote_number);

  if exists (select 1 from payments where external_ref = p_external_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_quote.job_id);
  end if;

  v_note := 'Deposit paid online — ' || v_quote.quote_number;
  if v_quote.status <> 'approved'
     or (p_opened_against is not null and v_quote.decided_at is distinct from p_opened_against) then
    v_note := v_note || ' (quote changed after checkout opened — review the job)';
  end if;
  if v_quote.job_id is not null and quote_deposit_outstanding_cents(v_quote.id) <= 0 then
    v_note := v_note || ' (deposit was already covered)';
  end if;

  v_job := coalesce(v_quote.job_id, convert_quote_to_job(v_quote.id));

  insert into payments (job_id, quote_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_job, v_quote.id, null, shop_today(), 'card', p_amount_cents, v_note, p_external_ref);

  perform refresh_job_payment_cache(v_job);

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_job,
                            'flagged', position('(' in v_note) > 0);
end;
$$;

revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from public;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from anon;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from authenticated;
grant execute on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) to service_role;
