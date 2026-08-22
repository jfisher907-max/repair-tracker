-- Review fixes to 0017/0018, applied before either shipped to the UI.
--
-- 1. The paid-to-date rule is simpler than 0017 made it: EVERY payment on a
--    job counts toward ANY of its invoices. Invoices are whole-job snapshots,
--    so a reissued invoice after an add-on must see money taken against the
--    first, fully paid one (INV-1 $800 paid, add-on deposit $200, INV-2
--    $1,200 — the customer owes $400, not $1,000). payments.invoice_id and
--    quote_id stay as information: which document the customer had in hand.
--
-- 2. "Deposit received" must count cash. The public quote page offered the
--    card button until a payment tagged with the quote existed, so a $500
--    deposit taken at the counter and recorded on the job would be collected
--    a second time online. Outstanding is now: the frozen deposit, minus
--    money on the job since approval, capped at what the job still owes.
--
-- 3. The deposit recorder never bounces real money. A soft-deleted quote, or
--    one the owner edited while the customer was on Stripe's page, still gets
--    its payment recorded — with a note that flags it for review — instead of
--    a 500 that Stripe retries for three days while the ledger stays blind.

create or replace function public.invoice_paid_cents(p_invoice_id uuid) returns integer
language sql stable security invoker
set search_path = public
as $$
  select coalesce(sum(p.amount_cents), 0)::integer
    from invoices x
    join payments p on p.job_id = x.job_id
   where x.id = p_invoice_id
$$;

comment on function public.invoice_paid_cents(uuid) is
  'All payments on the invoice''s job. Invoices are whole-job snapshots, so job money belongs to every live revision. Mirrored in lib/payments.ts — keep identical.';

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

  -- Owed is the greater of the job's charge math and its LARGEST live
  -- invoice — never the sum; invoices are revisions, not installments.
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
        update invoices
           set status = 'paid', paid_at = coalesce(v_last::timestamptz, now())
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
-- What a customer still owes on their deposit. Counts every payment on the
-- linked job made since approval (so an add-on's deposit does not claim the
-- original job's money), capped at the job's remaining balance so a settled
-- job never asks for a deposit.
-- ---------------------------------------------------------------------------

create or replace function public.quote_deposit_outstanding_cents(p_quote_id uuid) returns integer
language sql stable security invoker
set search_path = public
as $$
  select case
    when q.deposit_cents is null or q.deposit_cents <= 0 then 0
    when q.job_id is null then q.deposit_cents
    else greatest(0, least(
      q.deposit_cents - coalesce((
        select sum(p.amount_cents) from payments p
         where p.job_id = q.job_id
           and (p.quote_id = q.id or q.decided_at is null or p.created_at > q.decided_at)), 0),
      greatest(
        coalesce((select t.total_charged_cents from job_totals t where t.job_id = q.job_id), 0),
        coalesce((select max(i.total_cents) from invoices i
                   where i.job_id = q.job_id and i.status <> 'void'), 0))
      - coalesce((select sum(p.amount_cents) from payments p where p.job_id = q.job_id), 0)
    ))
  end
  from quotes q
  where q.id = p_quote_id
$$;

create or replace function public.get_public_quote(token uuid) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quote_number', q.quote_number,
    'status', q.status,
    'title', q.title,
    'description', q.description,
    'quote_date', q.created_at::date,
    'valid_until', q.valid_until,
    'customer_name', c.name,
    'vehicle_label', coalesce(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
    'labor_hours', q.labor_hours,
    'labor_rate_cents', q.labor_rate_cents,
    'tax_rate_bp', q.tax_rate_bp,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'description', l.description, 'qty', l.qty,
        'unit_charge_cents', l.unit_charge_cents, 'line_total_cents', l.line_total_cents,
        'declined', l.declined
      ) order by l.created_at), '[]'::jsonb)
      from public.quote_lines l where l.quote_id = q.id
    ),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', p.storage_path, 'caption', p.caption
      ) order by p.created_at), '[]'::jsonb)
      from public.job_photos p
      where p.job_id = q.job_id and p.customer_visible
    ),
    'deposit_kind', q.deposit_kind,
    'deposit_value', q.deposit_value,
    'deposit_cents', case
      when q.status = 'approved' then coalesce(q.deposit_cents, (q.approved_snapshot->>'deposit_cents')::integer)
      else quote_deposit_cents(q.id)
    end,
    'deposit_outstanding_cents', case
      when q.status = 'approved' then quote_deposit_outstanding_cents(q.id) else 0 end,
    'deposit_payable', (q.vehicle_id is not null or q.job_id is not null),
    'approved_at', q.decided_at,
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email
      ) from public.settings s limit 1
    )
  )
  from public.quotes q
  join public.customers c on c.id = q.customer_id
  left join public.vehicles v on v.id = q.vehicle_id
  where q.public_token = token and q.deleted_at is null
$$;

-- ---------------------------------------------------------------------------
-- Deposit recorder: always records; flags anything that changed underneath.
-- p_opened_against = the quote's decided_at when Checkout was opened.
-- ---------------------------------------------------------------------------

drop function if exists public.record_deposit_payment(uuid, text, integer, integer);

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

  -- Deliberately ignores deleted_at: money paid on a quote that was since
  -- trashed is still money, and the job link survives soft deletion.
  select q.id, q.job_id, q.quote_number, q.status, q.decided_at, q.vehicle_id
    into v_quote
    from quotes q
   where q.public_token = p_token
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown quote');
  end if;

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

  -- A deposit is the booking: the quote becomes a job the moment money lands.
  v_job := coalesce(v_quote.job_id, convert_quote_to_job(v_quote.id));

  insert into payments (job_id, quote_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_job, v_quote.id, null, shop_today(), 'card', p_amount_cents, v_note, p_external_ref);

  perform refresh_job_payment_cache(v_job);

  if p_fee_cents is not null and p_fee_cents > 0 then
    insert into expenses (date, category, vendor, description, amount_cents)
    values (shop_today(), 'Software & fees', 'Stripe',
            'Card processing fee — deposit ' || v_quote.quote_number, p_fee_cents);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_job,
                            'flagged', position('(' in v_note) > 0);
end;
$$;

revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from public;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from anon;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) from authenticated;
grant execute on function public.record_deposit_payment(uuid, text, integer, integer, timestamptz) to service_role;

-- The conversion used by the recorder must also survive a trashed quote.
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

  insert into jobs (vehicle_id, title, work_performed, labor_hours, labor_rate_cents, notes)
  values (v_quote.vehicle_id, v_quote.title, v_quote.description,
          v_quote.labor_hours, v_quote.labor_rate_cents,
          'From quote ' || v_quote.quote_number)
  returning id into v_job;

  insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents)
  select v_job, l.description, l.qty, 0, l.unit_charge_cents
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
