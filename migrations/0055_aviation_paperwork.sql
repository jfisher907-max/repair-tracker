-- 0055: aviation paperwork (AVN-3).
--
-- The owner, decision sheet edition 4, 2026-09-29:
--   AVN-3 "Should jet jobs get their own paperwork now, before the first one
--   comes in?" -> "Build it now".  AVN-2 -> "Don't name any types" (nothing
--   here names an aircraft type).
-- (0054 is SEC-2, anon grants off. This file was drafted as 0054 and moved up
-- one; nothing in it depends on 0054 being applied first.)
--
-- Adds: vehicles.service_line/registration/serial_number, jobs.airframe_hours,
-- quotes.service_line, invoices.service_line/aircraft; three guard triggers;
-- two keys (service_line, aircraft) on get_public_quote/get_public_invoice;
-- aircraft wording for apply_billing_plan's adjustment line.
-- Measured 2026-09-30: 13 vehicles (all road vehicles), 15 jobs, 10 quotes,
-- 12 invoices (10 paid, 2 void), 0 aviation requests; sequences invoice 19 /
-- job 16 / quote 11. Every row reads 'automotive' / null after this file,
-- which is what it is.
--
-- LAW (general information, not legal advice): AS 45.45.130-.240 governs
-- MOTOR VEHICLE repair - a vehicle registered under AS 28.10 (AS 45.45.240).
-- Aircraft are registered with the FAA (14 CFR Part 47), so aircraft paper
-- leaves off the AS 45.45.210 notice and the AS 45.45.190 part tags. The car
-- chain is untouched: every existing row and every car keeps the words it has.
--
-- The owner's open choices (AVN-3 needsFromJake 1-5) are the app's, in
-- lib/service-line.ts, EXCEPT the phone number on a phone OK: it stays
-- REQUIRED on every job (review blocker), so job_authorizations_phone_needs_number
-- is not touched here.
--
-- SECURITY: no new table, so no new policy; the columns sit under the existing
-- owner_all (is_owner()) policies. The public RPCs gain only the customer's own
-- aircraft identity (tail, serial, airframe hours - no notes, costs or profit),
-- and get_public_invoice names those three keys, never the whole column.
-- Grants restated unchanged. The three trigger functions are SECURITY INVOKER
-- and carry the house lines (0054): revoke from public and anon, execute for
-- the roles that write these tables.
--
-- DEPLOY ORDER: apply this BEFORE the AVN-3 app code. The live app runs fine
-- on the new schema (defaults plus the triggers); the new app on the old
-- schema cannot save a vehicle, job, quote or invoice.
--
-- Run as ONE batch (apply_migration / SQL editor): the guard in section 5
-- rolls the whole file back if any existing public output changed.
--
-- RE-RUNNING: a second run passes until the first aircraft (or aircraft
-- quote) is saved - the guard strips the two new keys from BOTH sides, so a
-- retry after an apply that timed out but did commit is harmless. Once an
-- aircraft exists, the guard's "everything is automotive" checks roll a
-- re-run back BY DESIGN. To see whether this file already landed, run the
-- Verify queries at the end (7 columns, 3 triggers) instead of re-running it.

-- 1. columns ---------------------------------------------------------------
alter table public.vehicles
  add column if not exists service_line  text not null default 'automotive',
  add column if not exists registration  text,
  add column if not exists serial_number text;
alter table public.vehicles drop constraint if exists vehicles_service_line_check;
alter table public.vehicles add constraint vehicles_service_line_check
  check (service_line in ('automotive', 'aviation'));
-- Car-only fields stay off aircraft, aircraft-only fields off cars. service_line
-- is NOT NULL and "x is null" is never NULL, so nothing slips through on NULL.
alter table public.vehicles drop constraint if exists vehicles_line_fields_check;
alter table public.vehicles add constraint vehicles_line_fields_check
  check (case when service_line = 'aviation'
              then vin is null and license_plate is null
              else registration is null and serial_number is null end);
comment on column public.vehicles.service_line is 'automotive (default; every row before 0055) or aviation. Same words as service_requests.service_line (0046). Fixed once the vehicle has a live job or quote (trigger vehicles_service_line_fixed). 0055.';
comment on column public.vehicles.registration is 'Aircraft tail number (registration mark), uppercase, no spaces. Aviation only. 0055.';
comment on column public.vehicles.serial_number is 'Aircraft serial number. Aviation only. 0055.';

alter table public.jobs add column if not exists airframe_hours numeric(9,1);
alter table public.jobs drop constraint if exists jobs_airframe_hours_check;
alter table public.jobs add constraint jobs_airframe_hours_check
  check (airframe_hours is null or airframe_hours >= 0);
comment on column public.jobs.airframe_hours is 'Airframe hours at this job (aircraft); the aviation counterpart of odometer_miles. 0055.';

alter table public.quotes add column if not exists service_line text not null default 'automotive';
alter table public.quotes drop constraint if exists quotes_service_line_check;
alter table public.quotes add constraint quotes_service_line_check
  check (service_line in ('automotive', 'aviation'));
comment on column public.quotes.service_line is 'Which paper the customer gets: automotive = Estimate (AS 45.45 wording), aviation = Quote. Follows the quote''s vehicle; fixed once sent; an aviation quote goes out only with its aircraft attached (trigger quotes_paper_follows_vehicle). 0055.';

alter table public.invoices
  add column if not exists service_line text not null default 'automotive',
  add column if not exists aircraft     jsonb;
alter table public.invoices drop constraint if exists invoices_service_line_check;
alter table public.invoices add constraint invoices_service_line_check
  check (service_line in ('automotive', 'aviation'));
alter table public.invoices drop constraint if exists invoices_aircraft_check;
alter table public.invoices add constraint invoices_aircraft_check
  check (aircraft is null or (service_line = 'aviation' and jsonb_typeof(aircraft) = 'object'));
comment on column public.invoices.service_line is 'Frozen at creation from the job''s vehicle. aviation = no AS 45.45.210 notice, no part-condition tags. Frozen once issued. 0055.';
comment on column public.invoices.aircraft is 'Frozen {registration, serial_number, airframe_hours} for aviation invoices; null otherwise. Re-frozen on drafts only; frozen once issued. 0055.';

-- 2. guards ------------------------------------------------------------------
-- A quote's paper follows its vehicle, is fixed once the customer has it, and
-- an aviation quote only goes out with its aircraft on it (review hardening:
-- a vehicleless quote flipped to Aircraft by mistake must not leave as Quote
-- paper for what is really a car job). sent_at is in the column list so the
-- send itself is checked.
create or replace function public.quotes_paper_follows_vehicle() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line text;
begin
  if new.vehicle_id is not null then
    select v.service_line into v_line from public.vehicles v where v.id = new.vehicle_id;
    if v_line is not null then
      new.service_line := v_line;
    end if;
  end if;
  if tg_op = 'UPDATE'
     and new.service_line is distinct from old.service_line
     and (old.sent_at is not null or old.status <> 'draft') then
    raise exception 'quote_service_line_fixed'
      using detail = 'This quote already went to the customer. Make a new quote instead.';
  end if;
  if new.service_line = 'aviation' and new.vehicle_id is null and new.sent_at is not null then
    raise exception 'quote_needs_aircraft'
      using detail = 'Attach the aircraft before this quote goes to the customer.';
  end if;
  return new;
end;
$$;
drop trigger if exists quotes_paper_follows_vehicle on public.quotes;
create trigger quotes_paper_follows_vehicle
  before insert or update of vehicle_id, service_line, sent_at on public.quotes
  for each row execute function public.quotes_paper_follows_vehicle();

create or replace function public.vehicles_service_line_fixed() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.service_line is distinct from old.service_line and (
       exists (select 1 from public.jobs j   where j.vehicle_id = old.id and j.deleted_at is null)
    or exists (select 1 from public.quotes q where q.vehicle_id = old.id and q.deleted_at is null)
  ) then
    raise exception 'vehicle_service_line_fixed'
      using detail = 'This one already has work on it. Add it again as the right kind.';
  end if;
  return new;
end;
$$;
drop trigger if exists vehicles_service_line_fixed on public.vehicles;
create trigger vehicles_service_line_fixed
  before update of service_line on public.vehicles
  for each row execute function public.vehicles_service_line_fixed();

create or replace function public.invoices_paper_frozen() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('sent', 'paid', 'void')
     and (new.service_line is distinct from old.service_line
          or new.aircraft is distinct from old.aircraft) then
    raise exception 'invoice_paper_frozen'
      using detail = 'This invoice was issued. Void it and issue a new one.';
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_paper_frozen on public.invoices;
create trigger invoices_paper_frozen
  before update of service_line, aircraft on public.invoices
  for each row execute function public.invoices_paper_frozen();

-- House lines (0054): no EXECUTE for logged-out visitors or PUBLIC; the roles
-- that write these tables (authenticated, service_role, and postgres inside the
-- DEFINER functions) keep it.
revoke all on function public.quotes_paper_follows_vehicle() from public, anon;
revoke all on function public.vehicles_service_line_fixed() from public, anon;
revoke all on function public.invoices_paper_frozen() from public, anon;
grant execute on function
  public.quotes_paper_follows_vehicle(), public.vehicles_service_line_fixed(),
  public.invoices_paper_frozen()
  to authenticated, service_role;

-- 3. what the public pages return today, for every existing row ---------------
-- Deleted quotes and void invoices return null today and must still return null.
create temp table _0055_quote_before as
  select q.public_token as token, public.get_public_quote(q.public_token) as doc from public.quotes q;
create temp table _0055_invoice_before as
  select i.public_token as token, public.get_public_invoice(i.public_token) as doc from public.invoices i;

-- 4. the functions -------------------------------------------------------------
-- Live body read 2026-09-30 (pg_get_functiondef); only the vehicle_label CASE
-- and the two new keys differ. The car branch of the CASE is the live
-- expression, character for character.
create or replace function public.get_public_quote(token uuid)
returns jsonb
language sql
stable security definer
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
    'vehicle_label', case
      when q.service_line = 'aviation'
        then coalesce(concat_ws(' · ',
               nullif(btrim(v.registration), ''),
               nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), '')), '')
      else coalesce(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), '')
    end,
    'service_line', q.service_line,
    'aircraft', case when q.service_line = 'aviation' and v.id is not null
      then jsonb_build_object('registration', v.registration, 'serial_number', v.serial_number)
      else null end,
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
revoke all on function public.get_public_quote(uuid) from public;
grant execute on function public.get_public_quote(uuid) to anon, authenticated, service_role;

-- Live body read 2026-09-30; only service_line and aircraft are new. The '•••'
-- mask characters are copied from the live definition exactly.
create or replace function public.get_public_invoice(token uuid)
returns jsonb
language sql
stable security definer
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
    'authorizations', coalesce((
      select jsonb_agg(
               (a - 'phone_called')
               || jsonb_build_object('phone_called',
                    case when coalesce(a->>'phone_called', '') = '' then null
                         else '•••' || right(regexp_replace(a->>'phone_called', '[^0-9]', '', 'g'), 4)
                    end)
               order by t.ord)
        from jsonb_array_elements(coalesce(i.authorizations, '[]'::jsonb)) with ordinality as t(a, ord)
    ), '[]'::jsonb),
    'service_line', i.service_line,
    -- Three named keys, never the whole column: a future owner-only key can't leak.
    'aircraft', case when i.aircraft is null then null else jsonb_build_object(
        'registration',   i.aircraft->>'registration',
        'serial_number',  i.aircraft->>'serial_number',
        'airframe_hours', i.aircraft->'airframe_hours') end,
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
revoke all on function public.get_public_invoice(uuid) from public;
grant execute on function public.get_public_invoice(uuid) to anon, authenticated, service_role;

-- Live body read 2026-09-30. ONLY the adjustment line's description changes.
-- Diff against pg_get_functiondef before applying (UNDO step 0).
create or replace function public.apply_billing_plan(p_job_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_job    jobs%rowtype;
  v_op     jsonb;
  v_line   part_lines%rowtype;
  v_ql     quote_lines%rowtype;
  v_charge integer;
  v_before integer;
  v_after  integer;
  v_auth   integer;
  v_over   integer;
begin
  select * into v_job from jobs where id = p_job_id and deleted_at is null for update;
  if not found then
    raise exception 'job not found';
  end if;
  if exists (select 1 from invoices where job_id = p_job_id and status in ('sent', 'paid')) then
    raise exception 'this job already has a sent or paid invoice - issued invoices never change; void and reissue instead';
  end if;
  if not exists (select 1 from quotes where job_id = p_job_id and applied_at is not null) then
    raise exception 'this job has no approved estimate to bill against';
  end if;

  select current_cents, authorized_cents into v_before, v_auth
    from job_authorized_totals where job_id = p_job_id;
  if coalesce(v_auth, 0) <= 0 then
    raise exception 'there is no approved total on file for this job - record the customer''s OK first';
  end if;

  for v_op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select * into v_line from part_lines
     where id = nullif(v_op->>'line_id', '')::uuid and job_id = p_job_id
     for update;
    if not found then
      raise exception 'that part line is not on this job';
    end if;

    if v_op->>'op' = 'set_charge' then
      v_charge := nullif(v_op->>'unit_charge_cents', '')::integer;
      if v_charge is null or v_charge < 0 then
        raise exception 'a charge must be zero or more';
      end if;
      -- Billing at the approved price only ever LOWERS a charge.
      if v_charge > coalesce(v_line.unit_charge_cents, v_line.unit_cost_cents) then
        raise exception '"%" would go up - billing at the approved price never raises a charge', v_line.description;
      end if;
      if nullif(v_op->>'quote_line_id', '') is not null then
        select l.* into v_ql
          from quote_lines l join quotes q on q.id = l.quote_id
         where l.id = (v_op->>'quote_line_id')::uuid and q.job_id = p_job_id and not l.declined;
        if not found then
          raise exception 'that approved line is not on this job';
        end if;
        if round(v_line.qty * v_charge) > v_ql.line_total_cents then
          raise exception '"%" would bill more than its approved line', v_line.description;
        end if;
        update part_lines set unit_charge_cents = v_charge, quote_line_id = v_ql.id where id = v_line.id;
      else
        update part_lines set unit_charge_cents = v_charge where id = v_line.id;
      end if;

    elsif v_op->>'op' = 'move_tax' then
      -- Counter tax typed as a part: its cost moves onto its receipt, where it
      -- is cost and never charge (0027). The job's cost doesn't change.
      if v_line.receipt_id is null then
        raise exception '"%" has no receipt to move its tax onto', v_line.description;
      end if;
      update receipts
         set tax_cents = tax_cents + round(v_line.qty * v_line.unit_cost_cents)::integer
       where id = v_line.receipt_id;
      delete from part_lines where id = v_line.id;

    elsif v_op->>'op' = 'cost_only' then
      update part_lines set on_invoice = false, unit_charge_cents = 0 where id = v_line.id;

    else
      raise exception 'unknown step: %', coalesce(v_op->>'op', 'none');
    end if;
  end loop;

  -- Whatever still sits over the approval (extra labor, say) comes off as ONE
  -- visible line, recomputed on every run - never stacked.
  delete from part_lines where job_id = p_job_id and is_adjustment;
  select current_cents, authorized_cents into v_after, v_auth
    from job_authorized_totals where job_id = p_job_id;
  v_over := v_after - v_auth;
  if v_over > 0 then
    if v_job.parts_charged_override_cents is not null then
      -- Line charges are ignored under an override, so the override comes down.
      update jobs set parts_charged_override_cents = parts_charged_override_cents - v_over
       where id = p_job_id;
    else
      insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents,
                              is_adjustment, condition)
      values (p_job_id,
              -- 0055: an aircraft job's paper says Quote (AVN-3); a car's is unchanged.
              case when (select v.service_line from vehicles v where v.id = v_job.vehicle_id) = 'aviation'
                   then 'Adjustment to approved quote'
                   else 'Adjustment to approved estimate' end,
              1, 0, -v_over, true, 'not_part');
    end if;
    select current_cents into v_after from job_authorized_totals where job_id = p_job_id;
  end if;

  -- The AS 45.45.170(c) record: billed at the estimate, and from what.
  update jobs
     set notes = concat_ws(E'\n', nullif(notes, ''),
           'Billed at the approved estimate $' || to_char(v_auth / 100.0, 'FM999,990.00')
           || ' before tax on ' || shop_today()
           || ' (the job had come to $' || to_char(v_before / 100.0, 'FM999,990.00') || ').')
   where id = p_job_id;

  if exists (select 1 from payments where job_id = p_job_id) then
    perform refresh_job_payment_cache(p_job_id);
  end if;

  return jsonb_build_object('before_cents', v_before, 'after_cents', v_after, 'authorized_cents', v_auth);
end
$$;
revoke all on function public.apply_billing_plan(uuid, jsonb) from public;
revoke all on function public.apply_billing_plan(uuid, jsonb) from anon;
grant execute on function public.apply_billing_plan(uuid, jsonb) to authenticated, service_role;

-- 5. guard: existing documents did not change, or roll everything back --------
-- Every existing key and value is byte-identical, the two new keys read
-- automotive / null on every existing row that returns a document, and no
-- existing row became anything but automotive. Both sides drop the two new
-- keys: on a first run "before" has neither (a no-op), on a re-run it has
-- both, and comparing them one-sided would flag every live document.
do $$
declare
  n int;
begin
  select count(*) into n from _0055_quote_before b
   where (public.get_public_quote(b.token) - 'service_line' - 'aircraft')
         is distinct from (b.doc - 'service_line' - 'aircraft');
  if n <> 0 then
    raise exception '0055: get_public_quote output changed for % existing quote(s) - rolling back', n;
  end if;
  select count(*) into n from _0055_invoice_before b
   where (public.get_public_invoice(b.token) - 'service_line' - 'aircraft')
         is distinct from (b.doc - 'service_line' - 'aircraft');
  if n <> 0 then
    raise exception '0055: get_public_invoice output changed for % existing invoice(s) - rolling back', n;
  end if;
  select count(*) into n from (
    select public.get_public_quote(b.token) as o from _0055_quote_before b where b.doc is not null
    union all
    select public.get_public_invoice(b.token) from _0055_invoice_before b where b.doc is not null) s
   where (s.o->>'service_line') is distinct from 'automotive'
      or coalesce(jsonb_typeof(s.o->'aircraft'), 'missing') <> 'null';
  if n <> 0 then
    raise exception '0055: % existing public document(s) gained a non-automotive key - rolling back', n;
  end if;
  select count(*) into n from (
    select service_line from public.vehicles
    union all select service_line from public.quotes
    union all select service_line from public.invoices) s
   where s.service_line <> 'automotive';
  if n <> 0 then
    raise exception '0055: % existing row(s) not automotive - rolling back', n;
  end if;
  select count(*) into n from public.invoices where aircraft is not null;
  if n <> 0 then
    raise exception '0055: % existing invoice(s) carry an aircraft block - rolling back', n;
  end if;
end;
$$;
drop table _0055_quote_before;
drop table _0055_invoice_before;

-- Verify after applying (read-only):
--   select table_name, column_name, is_nullable, column_default from information_schema.columns
--    where table_schema='public' and column_name in ('service_line','registration','serial_number','airframe_hours','aircraft')
--      and table_name in ('vehicles','jobs','quotes','invoices');                  -- 7 rows
--   select conrelid::regclass, conname from pg_constraint where conname in ('vehicles_service_line_check',
--     'vehicles_line_fields_check','jobs_airframe_hours_check','quotes_service_line_check',
--     'invoices_service_line_check','invoices_aircraft_check');                     -- 6 rows
--   select tgname, pg_get_triggerdef(oid) from pg_trigger where tgname in ('quotes_paper_follows_vehicle',
--     'vehicles_service_line_fixed','invoices_paper_frozen');                       -- 3 rows; quotes' lists vehicle_id, service_line, sent_at
--   select proname, proacl from pg_proc where proname in ('get_public_quote','get_public_invoice','apply_billing_plan',
--     'quotes_paper_follows_vehicle','vehicles_service_line_fixed','invoices_paper_frozen');
--     -- get_public_*: anon, authenticated, service_role (+ postgres). apply_billing_plan and the three
--     -- trigger functions: authenticated, service_role (+ postgres); no anon, no PUBLIC (=X/).
--   select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1;
--     -- none of the three trigger functions, nor apply_billing_plan
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'job_authorizations_phone_needs_number';
--     -- unchanged: CHECK (((method <> 'phone'::text) OR (btrim(COALESCE(phone_called, ''::text)) <> ''::text)))
--   select (select count(*) from vehicles) v, (select count(*) from jobs) j,
--          (select count(*) from quotes) q, (select count(*) from invoices) i;       -- 13 / 15 / 10 / 12
--   select last_value from invoice_number_seq; -- 19   job_number_seq -- 16   quote_number_seq -- 11
--
-- PROOF (by hand; ends with RAISE so nothing survives; explicit numbers so no sequence moves).
-- Expected: ERROR: PROOF OK - rolled back. Any "FAIL:" names the rule that broke.
--   do $proof$
--   declare c uuid; air uuid; car uuid; q uuid; qn uuid; qm uuid; qa uuid; qc uuid; j uuid; ja uuid; jc uuid; inv uuid; t text;
--   begin
--     insert into customers (name) values ('ZZ PROOF 0055') returning id into c;
--     -- an aircraft refuses a VIN; a car refuses a tail number
--     begin insert into vehicles (customer_id, service_line, vin) values (c, 'aviation', 'X');
--       raise exception 'FAIL: aircraft took a VIN'; exception when check_violation then
--         if sqlerrm not like '%vehicles_line_fields_check%' then raise; end if; end;
--     begin insert into vehicles (customer_id, registration) values (c, 'ZZTEST');
--       raise exception 'FAIL: car took a tail'; exception when check_violation then
--         if sqlerrm not like '%vehicles_line_fields_check%' then raise; end if; end;
--     insert into vehicles (customer_id, service_line, registration, serial_number, make, model)
--       values (c, 'aviation', 'ZZTEST', 'SN-TEST', 'Make', 'Model') returning id into air;
--     insert into vehicles (customer_id, make, model) values (c, 'Make', 'Car') returning id into car;
--     -- a quote on an aircraft stores aviation even when sent up as automotive
--     insert into quotes (quote_number, customer_id, vehicle_id, title, service_line)
--       values ('ZZ-Q0055', c, air, 'Proof', 'automotive') returning id into q;
--     select service_line into t from quotes where id = q;
--     if t is distinct from 'aviation' then raise exception 'FAIL: quote paper %', t; end if;
--     if (select get_public_quote(public_token)->>'vehicle_label' from quotes where id = q) is distinct from 'ZZTEST · Make Model'
--       then raise exception 'FAIL: public label'; end if;
--     if (select get_public_quote(public_token)->'aircraft' from quotes where id = q)
--        is distinct from '{"registration":"ZZTEST","serial_number":"SN-TEST"}'::jsonb
--       then raise exception 'FAIL: public quote aircraft block'; end if;
--     update quotes set status = 'sent', sent_at = now() where id = q;
--     -- a sent quote can't switch to a car, and can't lose its aircraft
--     begin update quotes set vehicle_id = car where id = q; raise exception 'FAIL: sent quote moved';
--       exception when raise_exception then if sqlerrm <> 'quote_service_line_fixed' then raise; end if; end;
--     begin update quotes set vehicle_id = null where id = q; raise exception 'FAIL: sent quote lost its aircraft';
--       exception when raise_exception then if sqlerrm <> 'quote_needs_aircraft' then raise; end if; end;
--     -- an aviation quote with no aircraft can't be sent; a car quote with no vehicle still can
--     insert into quotes (quote_number, customer_id, title, service_line)
--       values ('ZZ-Q0055n', c, 'P', 'aviation') returning id into qn;
--     begin update quotes set status = 'sent', sent_at = now() where id = qn;
--       raise exception 'FAIL: aviation quote went out with no aircraft';
--       exception when raise_exception then if sqlerrm <> 'quote_needs_aircraft' then raise; end if; end;
--     insert into quotes (quote_number, customer_id, title) values ('ZZ-Q0055m', c, 'P') returning id into qm;
--     update quotes set status = 'sent', sent_at = now() where id = qm;
--     if (select service_line from quotes where id = qm) is distinct from 'automotive' then raise exception 'FAIL: car quote paper'; end if;
--     -- an aircraft with a quote can't flip to a car
--     begin update vehicles set service_line = 'automotive', registration = null, serial_number = null where id = air;
--       raise exception 'FAIL: aircraft flipped';
--       exception when raise_exception then if sqlerrm <> 'vehicle_service_line_fixed' then raise; end if; end;
--     begin insert into jobs (job_number, vehicle_id, title, stage, airframe_hours) values ('ZZ-J0055x', air, 'x', 'done', -1);
--       raise exception 'FAIL: negative hours'; exception when check_violation then
--         if sqlerrm not like '%jobs_airframe_hours_check%' then raise; end if; end;
--     -- billing wording, aircraft and car: approved $50, job comes to $100 of labor
--     insert into jobs (job_number, vehicle_id, title, stage, labor_hours, labor_rate_cents)
--       values ('ZZ-J0055a', air, 'Proof', 'done', 1, 10000) returning id into ja;
--     insert into jobs (job_number, vehicle_id, title, stage, labor_hours, labor_rate_cents)
--       values ('ZZ-J0055c', car, 'Proof', 'done', 1, 10000) returning id into jc;
--     insert into quotes (quote_number, customer_id, vehicle_id, title, status, job_id, applied_at, approved_snapshot)
--       values ('ZZ-Q0055a', c, air, 'P', 'approved', ja, now(), '{"labor_hours":1,"labor_rate_cents":5000,"lines":[]}') returning id into qa;
--     insert into quotes (quote_number, customer_id, vehicle_id, title, status, job_id, applied_at, approved_snapshot)
--       values ('ZZ-Q0055c', c, car, 'P', 'approved', jc, now(), '{"labor_hours":1,"labor_rate_cents":5000,"lines":[]}') returning id into qc;
--     perform apply_billing_plan(ja, '[]'); perform apply_billing_plan(jc, '[]');
--     if (select description from part_lines where job_id = ja and is_adjustment) is distinct from 'Adjustment to approved quote'
--       then raise exception 'FAIL: aircraft adjustment wording'; end if;
--     if (select description from part_lines where job_id = jc and is_adjustment) is distinct from 'Adjustment to approved estimate'
--       then raise exception 'FAIL: car adjustment wording changed'; end if;
--     -- the phone number on a phone OK stays required on EVERY job (owner, review blocker).
--     -- delta_cents is GENERATED ALWAYS (new_total - previous_ceiling): never listed here.
--     begin insert into job_authorizations (job_id, previous_ceiling_cents, new_total_cents,
--                                           description, method, by_name, authorized_at)
--       values (ja, 5000, 10000, 'Proof', 'phone', 'ZZ', now());
--       raise exception 'FAIL: aircraft phone OK took no number';
--       exception when check_violation then
--         if sqlerrm not like '%job_authorizations_phone_needs_number%' then raise; end if; end;
--     -- invoices: a car refuses an aircraft block; an aviation draft may change, issued may not
--     insert into jobs (job_number, vehicle_id, title, stage, airframe_hours) values ('ZZ-J0055', air, 'P', 'done', 1234.5) returning id into j;
--     begin insert into invoices (invoice_number, job_id, customer_id, customer_name, service_line, aircraft)
--       values ('ZZ-INV0055x', j, c, 'x', 'automotive', '{"registration":"ZZTEST"}');
--       raise exception 'FAIL: car invoice took aircraft'; exception when check_violation then
--         if sqlerrm not like '%invoices_aircraft_check%' then raise; end if; end;
--     insert into invoices (invoice_number, job_id, customer_id, customer_name, vehicle_label, service_line, aircraft, total_cents)
--       values ('ZZ-INV0055', j, c, 'ZZ PROOF 0055', 'ZZTEST · Make Model', 'aviation',
--               '{"registration":"ZZTEST","serial_number":"SN-TEST","airframe_hours":1234.5,"owner_only":"x"}', 10000)
--       returning id into inv;
--     update invoices set aircraft = jsonb_set(aircraft, '{airframe_hours}', '1240.0') where id = inv;
--     if (select get_public_invoice(public_token)->'aircraft' from invoices where id = inv)
--        is distinct from '{"registration":"ZZTEST","serial_number":"SN-TEST","airframe_hours":1240.0}'::jsonb
--       then raise exception 'FAIL: public aircraft block (extra key or wrong value)'; end if;
--     if (select get_public_invoice(public_token)->>'service_line' from invoices where id = inv) is distinct from 'aviation'
--       then raise exception 'FAIL: public invoice line'; end if;
--     update invoices set status = 'sent', sent_at = now() where id = inv;
--     begin update invoices set aircraft = jsonb_set(aircraft, '{airframe_hours}', '1.0') where id = inv;
--       raise exception 'FAIL: issued aircraft changed';
--       exception when raise_exception then if sqlerrm <> 'invoice_paper_frozen' then raise; end if; end;
--     begin update invoices set service_line = 'automotive', aircraft = null where id = inv;
--       raise exception 'FAIL: issued invoice changed paper';
--       exception when raise_exception then if sqlerrm <> 'invoice_paper_frozen' then raise; end if; end;
--     raise exception 'PROOF OK - rolled back';
--   end $proof$;
--   -- then: select last_value from invoice_number_seq / job_number_seq / quote_number_seq; -- still 19 / 16 / 11
--
-- UNDO (loses any aircraft entered since):
--   0. BEFORE applying, save the prior bodies:
--        select pg_get_functiondef(p) from (values ('public.get_public_quote(uuid)'::regprocedure),
--          ('public.get_public_invoice(uuid)'::regprocedure), ('public.apply_billing_plan(uuid,jsonb)'::regprocedure)) t(p);
--   1. re-run those three saved bodies, then restate their grants as above.
--   2. drop trigger if exists quotes_paper_follows_vehicle on public.quotes;
--      drop trigger if exists vehicles_service_line_fixed on public.vehicles;
--      drop trigger if exists invoices_paper_frozen on public.invoices;
--      drop function if exists public.quotes_paper_follows_vehicle(), public.vehicles_service_line_fixed(), public.invoices_paper_frozen();
--   3. alter table public.invoices drop constraint if exists invoices_aircraft_check,
--        drop column if exists aircraft, drop column if exists service_line;
--      alter table public.quotes drop column if exists service_line;
--      alter table public.jobs drop column if exists airframe_hours;
--      alter table public.vehicles drop constraint if exists vehicles_line_fields_check,
--        drop column if exists serial_number, drop column if exists registration, drop column if exists service_line;
