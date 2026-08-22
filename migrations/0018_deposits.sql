-- Deposits on approved quotes.
--
-- The owner stores a RULE on the quote (parts / percent / fixed). It is
-- resolved against what the customer actually approved — declined lines
-- excluded — and frozen into quotes.deposit_cents and the approval snapshot.
-- That frozen figure is the only amount ever charged: unticking a $900 part
-- can never leave a $900 deposit on a $300 job, and the owner changing the
-- rule after approval cannot change what an approved customer is asked for
-- without a logged, attributed "deposit_changed" entry.
--
-- A deposit is real money on a job, so paying one converts the quote to a
-- job (atomically, in convert_quote_to_job — which the owner's Convert
-- button now uses too, closing the twin-job hole in the old client code).
-- Requires 0017 (invoice_paid_cents, refresh_job_payment_cache, shop_today).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists deposit_kind text not null default 'none',
  add column if not exists deposit_value integer,
  add column if not exists deposit_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_deposit_kind_check') then
    alter table public.quotes add constraint quotes_deposit_kind_check
      check (deposit_kind in ('none', 'parts', 'percent', 'fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_deposit_value_check') then
    alter table public.quotes add constraint quotes_deposit_value_check
      check (deposit_value is null or deposit_value >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_deposit_cents_check') then
    alter table public.quotes add constraint quotes_deposit_cents_check
      check (deposit_cents is null or deposit_cents >= 0);
  end if;
end $$;

comment on column public.quotes.deposit_kind is
  'Deposit rule: none | parts (approved line total) | percent (deposit_value = basis points) | fixed (deposit_value = cents).';
comment on column public.quotes.deposit_cents is
  'The RESOLVED deposit, frozen at approval against the approved subset. Null until approved. The only amount ever charged.';

alter table public.payments
  add column if not exists quote_id uuid references public.quotes (id);

create index if not exists payments_quote_id_idx
  on public.payments (quote_id) where quote_id is not null;

comment on column public.payments.quote_id is
  'Set on deposits: the quote this money was put down against. job_id is still required — a deposit converts the quote to a job.';

-- The approval trail gains a third kind of entry: a deposit term agreed
-- after approval, recorded without touching the original approval row.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.quote_approvals'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%response%';
  if v_name is not null then
    execute format('alter table public.quote_approvals drop constraint %I', v_name);
  end if;
  alter table public.quote_approvals
    add constraint quote_approvals_response_check
    check (response in ('approved', 'declined', 'deposit_changed'));
end $$;

-- ---------------------------------------------------------------------------
-- The resolver — one place turns the rule into cents. quote_totals already
-- excludes declined lines, so after approval this is the approved subset.
-- ---------------------------------------------------------------------------

create or replace function public.quote_deposit_cents(p_quote_id uuid) returns integer
language sql stable security invoker
set search_path = public
as $$
  select nullif(greatest(0, least(t.total_cents,
           case q.deposit_kind
             when 'parts'   then t.lines_cents
             when 'percent' then round(t.total_cents * coalesce(q.deposit_value, 0) / 10000.0)::integer
             when 'fixed'   then coalesce(q.deposit_value, 0)
             else 0
           end)), 0)
    from quotes q
    join quote_totals t on t.quote_id = q.id
   where q.id = p_quote_id
$$;

comment on function public.quote_deposit_cents(uuid) is
  'Resolves the quote''s deposit rule against its current (non-declined) lines. Null when no deposit. Mirrored in lib/billing.ts depositForRule — keep identical.';

-- ---------------------------------------------------------------------------
-- Public quote: deposit figures the customer may see.
-- ---------------------------------------------------------------------------

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
    -- The rule, so the page can show the deposit moving as lines are
    -- unticked; the frozen figure once approved; and what has been paid.
    'deposit_kind', q.deposit_kind,
    'deposit_value', q.deposit_value,
    'deposit_cents', case
      when q.status = 'approved' then coalesce(q.deposit_cents, (q.approved_snapshot->>'deposit_cents')::integer)
      else quote_deposit_cents(q.id)
    end,
    'deposit_paid_cents', coalesce(
      (select sum(p.amount_cents) from public.payments p where p.quote_id = q.id), 0),
    -- A deposit turns the quote into a job, and a job needs a vehicle.
    'deposit_payable', (q.vehicle_id is not null or q.job_id is not null),
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
-- Customer approval: resolve + freeze the deposit with the decision.
-- ---------------------------------------------------------------------------

create or replace function public.respond_public_quote(
  token uuid, response text,
  p_name text default null, p_consent boolean default null,
  p_ip text default null, p_user_agent text default null,
  p_declined_ids uuid[] default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote    record;
  v_declined uuid[];
  v_labor    integer;
  v_parts    integer;
  v_tax      integer;
  v_deposit  integer;
  v_snapshot jsonb;
  new_status text;
begin
  if response not in ('approved', 'declined') then
    return null;
  end if;

  select * into v_quote
    from quotes
   where public_token = token and status = 'sent'
     and applied_at is null and deleted_at is null
     for update;

  if not found then
    return null;
  end if;

  select coalesce(array_agg(l.id), '{}') into v_declined
    from quote_lines l
   where l.quote_id = v_quote.id
     and l.id = any(coalesce(p_declined_ids, '{}'));

  if response = 'approved' then
    if round(coalesce(v_quote.labor_hours, 0) * coalesce(v_quote.labor_rate_cents, 0)) = 0
       and not exists (
         select 1 from quote_lines l
          where l.quote_id = v_quote.id and not (l.id = any(v_declined))
       ) then
      return null;
    end if;

    update quote_lines l
       set declined = (l.id = any(v_declined))
     where l.quote_id = v_quote.id;
  end if;

  v_labor := round(coalesce(v_quote.labor_hours, 0) * coalesce(v_quote.labor_rate_cents, 0));
  select coalesce(sum(line_total_cents), 0) into v_parts
    from quote_lines where quote_id = v_quote.id and not declined;
  v_tax := round(((v_labor + v_parts) * coalesce(v_quote.tax_rate_bp, 0))::numeric / 10000);

  -- Resolved AFTER the declined flags are written, so it follows the
  -- approved subset. A decline carries no deposit.
  v_deposit := case when response = 'approved' then quote_deposit_cents(v_quote.id) else null end;

  v_snapshot := jsonb_build_object(
    'quote_number',     v_quote.quote_number,
    'title',            v_quote.title,
    'description',      v_quote.description,
    'valid_until',      v_quote.valid_until,
    'labor_hours',      v_quote.labor_hours,
    'labor_rate_cents', v_quote.labor_rate_cents,
    'labor_cents',      v_labor,
    'parts_cents',      v_parts,
    'tax_rate_bp',      v_quote.tax_rate_bp,
    'tax_cents',        v_tax,
    'total_cents',      v_labor + v_parts + v_tax,
    'deposit_kind',     v_quote.deposit_kind,
    'deposit_value',    v_quote.deposit_value,
    'deposit_cents',    v_deposit,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description',       l.description,
               'qty',               l.qty,
               'unit_charge_cents', l.unit_charge_cents,
               'line_total_cents',  l.line_total_cents,
               'declined',          l.declined)
             order by l.created_at)
        from quote_lines l where l.quote_id = v_quote.id), '[]'::jsonb),
    'response',   response,
    'by_name',    p_name,
    'frozen_at',  now()
  );

  insert into quote_approvals (quote_id, response, by_name, consent, ip, user_agent, snapshot)
  values (v_quote.id, response,
          nullif(btrim(coalesce(p_name, '')), ''),
          p_consent, p_ip, left(coalesce(p_user_agent, ''), 400), v_snapshot);

  update quotes
     set status              = response,
         decided_at          = now(),
         approved_by_name    = nullif(btrim(coalesce(p_name, '')), ''),
         approval_consent    = p_consent,
         approval_ip         = p_ip,
         approval_user_agent = left(coalesce(p_user_agent, ''), 400),
         approved_snapshot   = v_snapshot,
         deposit_cents       = v_deposit
   where id = v_quote.id
   returning status into new_status;

  return new_status;
end
$$;

-- ---------------------------------------------------------------------------
-- Owner: set or change the deposit term without disturbing the approval.
-- Runs as the owner under RLS. On an approved quote the change is appended
-- to the trail as 'deposit_changed', attributed like a verbal OK.
-- ---------------------------------------------------------------------------

create or replace function public.set_quote_deposit(
  p_quote_id uuid,
  p_kind     text,
  p_value    integer default null,
  p_by_name  text default null,
  p_method   text default null
) returns integer
language plpgsql security invoker
set search_path = public
as $$
declare
  v_quote  record;
  v_before integer;
  v_after  integer;
  v_total  integer;
begin
  if p_kind not in ('none', 'parts', 'percent', 'fixed') then
    raise exception 'unknown deposit kind %', p_kind;
  end if;

  select * into v_quote from quotes where id = p_quote_id and deleted_at is null for update;
  if not found then
    raise exception 'quote not found';
  end if;
  if exists (select 1 from payments where quote_id = p_quote_id) then
    raise exception 'a deposit has already been paid on this quote';
  end if;
  if v_quote.status = 'declined' then
    raise exception 'this quote was declined';
  end if;

  v_before := v_quote.deposit_cents;

  update quotes
     set deposit_kind  = p_kind,
         deposit_value = case when p_kind in ('percent', 'fixed') then p_value else null end
   where id = p_quote_id;

  if v_quote.status = 'approved' then
    v_after := quote_deposit_cents(p_quote_id);
    select total_cents into v_total from quote_totals where quote_id = p_quote_id;

    update quotes set deposit_cents = v_after where id = p_quote_id;

    if coalesce(v_after, 0) <> coalesce(v_before, 0) then
      insert into quote_approvals (quote_id, response, by_name, consent, method, snapshot)
      values (p_quote_id, 'deposit_changed',
              nullif(btrim(coalesce(p_by_name, '')), ''),
              null, p_method,
              jsonb_build_object(
                'deposit_before_cents', v_before,
                'deposit_after_cents',  v_after,
                'deposit_kind',         p_kind,
                'deposit_value',        p_value,
                'total_cents',          v_total,
                'frozen_at',            now()));
    end if;
    return v_after;
  end if;

  -- Not approved yet: nothing is frozen, the rule simply waits for approval.
  update quotes set deposit_cents = null where id = p_quote_id;
  return quote_deposit_cents(p_quote_id);
end;
$$;

revoke all on function public.set_quote_deposit(uuid, text, integer, text, text) from public;
revoke all on function public.set_quote_deposit(uuid, text, integer, text, text) from anon;
grant execute on function public.set_quote_deposit(uuid, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Quote -> job, atomically. Replaces the client-side conversion (which could
-- leave a twin job when the final link-back failed). Runs as the caller:
-- the owner under RLS, or the deposit recorder below.
-- ---------------------------------------------------------------------------

create or replace function public.convert_quote_to_job(p_quote_id uuid) returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_quote record;
  v_job   uuid;
begin
  select * into v_quote from quotes where id = p_quote_id and deleted_at is null for update;
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

  -- Only what the customer agreed to becomes work on the job.
  insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents)
  select v_job, l.description, l.qty, 0, l.unit_charge_cents
    from quote_lines l
   where l.quote_id = p_quote_id and not l.declined
   order by l.created_at;

  -- What they skipped is not lost — it lands in Follow-ups with the price.
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

-- ---------------------------------------------------------------------------
-- Deposit paid online (webhook) — service_role only, like record_card_payment.
-- Real settled money is always recorded; the only refusal is a duplicate.
-- ---------------------------------------------------------------------------

create or replace function public.record_deposit_payment(
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
  v_quote record;
  v_job   uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount');
  end if;
  if p_external_ref is null or length(trim(p_external_ref)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing reference');
  end if;

  select q.id, q.job_id, q.quote_number
    into v_quote
    from quotes q
   where q.public_token = p_token and q.deleted_at is null
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown quote');
  end if;

  if exists (select 1 from payments where external_ref = p_external_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_quote.job_id);
  end if;

  -- A deposit is the booking: the quote becomes a job the moment money lands.
  v_job := coalesce(v_quote.job_id, convert_quote_to_job(v_quote.id));

  insert into payments (job_id, quote_id, invoice_id, date, method, amount_cents, note, external_ref)
  values (v_job, v_quote.id, null, shop_today(), 'card', p_amount_cents,
          'Deposit paid online — ' || v_quote.quote_number, p_external_ref);

  perform refresh_job_payment_cache(v_job);

  if p_fee_cents is not null and p_fee_cents > 0 then
    insert into expenses (date, category, vendor, description, amount_cents)
    values (shop_today(), 'Software & fees', 'Stripe',
            'Card processing fee — deposit ' || v_quote.quote_number, p_fee_cents);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'job_id', v_job);
end;
$$;

revoke all on function public.record_deposit_payment(uuid, text, integer, integer) from public;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer) from anon;
revoke all on function public.record_deposit_payment(uuid, text, integer, integer) from authenticated;
grant execute on function public.record_deposit_payment(uuid, text, integer, integer) to service_role;
