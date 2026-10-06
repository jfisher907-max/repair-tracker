-- 0065: AOG and Nights & weekends markers on aircraft work (AOG-MARK).
--
-- The owner, 2026-09-30, answering "Want me to add an AOG rate and call-out
-- fee to the app?": "I think we keep the rate flexible, but we can definitely
-- have a category for AOG and nights + weekends."
-- So: two markers and no price. Nothing here touches a labor rate, a
-- multiplier or a fee - the rate stays whatever he types, and aircraft work
-- still starts at 0064's rate. An aircraft quote, job or invoice can carry
-- AOG, Nights & weekends, both, or neither; the customer's quote and invoice
-- print them as one "Service" line (lib/service-line.ts, serviceMarkText).
--
-- Adds: quotes/jobs/invoices .aog and .after_hours (boolean, not null, default
-- false); a CHECK on quotes and on invoices that both stay false off aviation
-- paper; invoices_paper_frozen freezes the two once issued; two keys (aog,
-- after_hours) on get_public_quote / get_public_invoice; convert_quote_to_job
-- carries the quote's two onto the job it makes.
-- Measured 2026-09-30: 13 vehicles, 15 jobs, 10 quotes, 12 invoices (10 paid,
-- 2 void), none aviation; sequences invoice 19 / job 16 / quote 11. Every row
-- reads false / false after this file, which is what it is.
--
-- QUOTE -> JOB IS CARRIED IN THE DATABASE, not by the app: convert_quote_to_job
-- has two callers - the quote page's Convert tap, and record_deposit_payment
-- (SECURITY DEFINER), which runs it headless when a customer pays a deposit
-- online. An app-side copy after the RPC would miss the deposit path. So the
-- two columns join its one jobs INSERT and nothing else in the body moves.
-- apply_quote_to_job (an ADD-ON quote landing on an existing job) is not
-- touched: that job already carries its own markers, the way it keeps its own
-- labor rate when an add-on lands, and an approval must not re-mark a job the
-- owner marked by hand. The add-on form starts from the job's markers (app).
--
-- CAR PAPER IS UNCHANGED: the CHECKs keep both false on every automotive quote
-- and invoice; DocView prints the Service line on aviation paper only; and the
-- app sends the two columns only when a marker is ticked or being cleared, so
-- a save with no marker is the same request it was before this file.
-- jobs get no CHECK: a job's line is its vehicle's (no service_line column),
-- and the invoice CHECK is what keeps a marker off car paper.
--
-- SECURITY: no new table, so no new policy; the columns sit under the existing
-- owner_all (is_owner()) policies. anon holds nothing on these tables (0054);
-- the column revokes restate it and the guard asserts it. The public RPCs gain
-- two booleans the customer's own paper prints - no notes, costs or profit.
-- Function grants restated unchanged.
--
-- DEPLOY ORDER: apply this BEFORE the AOG-MARK app code. The live app runs fine
-- on the new schema (defaults). The new app on the old schema saves everything
-- except a row with a marker ticked, and says why (paperErrorWords).
--
-- Run as ONE batch (apply_migration / SQL editor): the guard in section 6
-- rolls the whole file back if any existing public output changed.
--
-- RE-RUNNING: harmless until the first marker is saved - the guard strips the
-- two new keys from BOTH sides. Once any row carries a marker, the guard's
-- "everything reads false" checks roll a re-run back BY DESIGN; run the Verify
-- queries at the end instead.

-- 1. columns ---------------------------------------------------------------
-- All three columns in each CHECK are NOT NULL, so it can never pass on NULL.
alter table public.quotes
  add column if not exists aog         boolean not null default false,
  add column if not exists after_hours boolean not null default false;
alter table public.quotes drop constraint if exists quotes_aog_after_hours_check;
alter table public.quotes add constraint quotes_aog_after_hours_check
  check (service_line = 'aviation' or not (aog or after_hours));
comment on column public.quotes.aog is 'AOG (aircraft on ground) work: printed on the customer''s quote. A marker only - never changes the labor rate. Aviation only (quotes_aog_after_hours_check). Carried onto the job by convert_quote_to_job. 0065.';
comment on column public.quotes.after_hours is 'Nights & weekends work: printed on the customer''s quote. A marker only - never changes the labor rate. Aviation only (quotes_aog_after_hours_check). Carried onto the job by convert_quote_to_job. 0065.';

alter table public.jobs
  add column if not exists aog         boolean not null default false,
  add column if not exists after_hours boolean not null default false;
comment on column public.jobs.aog is 'AOG (aircraft on ground) work. Set on aircraft jobs only (the app; a car job saves false). Frozen onto the invoice when it is created. A marker only - never changes the labor rate. 0065.';
comment on column public.jobs.after_hours is 'Nights & weekends work. Set on aircraft jobs only (the app; a car job saves false). Frozen onto the invoice when it is created. A marker only - never changes the labor rate. 0065.';

alter table public.invoices
  add column if not exists aog         boolean not null default false,
  add column if not exists after_hours boolean not null default false;
alter table public.invoices drop constraint if exists invoices_aog_after_hours_check;
alter table public.invoices add constraint invoices_aog_after_hours_check
  check (service_line = 'aviation' or not (aog or after_hours));
comment on column public.invoices.aog is 'Frozen from the job at creation (re-frozen on drafts only): AOG work, printed on the invoice. Aviation only. Frozen once issued (invoices_paper_frozen). 0065.';
comment on column public.invoices.after_hours is 'Frozen from the job at creation (re-frozen on drafts only): Nights & weekends work, printed on the invoice. Aviation only. Frozen once issued (invoices_paper_frozen). 0065.';

-- House lines (0054/0064): logged-out visitors hold nothing on the new columns.
revoke all (aog, after_hours) on public.quotes   from public, anon;
revoke all (aog, after_hours) on public.jobs     from public, anon;
revoke all (aog, after_hours) on public.invoices from public, anon;

-- 2. an issued invoice's markers are frozen with the rest of its paper -------
-- The 0055 body plus the two columns; the trigger's column list gains them.
create or replace function public.invoices_paper_frozen() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('sent', 'paid', 'void')
     and (new.service_line is distinct from old.service_line
          or new.aircraft is distinct from old.aircraft
          or new.aog is distinct from old.aog
          or new.after_hours is distinct from old.after_hours) then
    raise exception 'invoice_paper_frozen'
      using detail = 'This invoice was issued. Void it and issue a new one.';
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_paper_frozen on public.invoices;
create trigger invoices_paper_frozen
  before update of service_line, aircraft, aog, after_hours on public.invoices
  for each row execute function public.invoices_paper_frozen();
revoke all on function public.invoices_paper_frozen() from public, anon;
grant execute on function public.invoices_paper_frozen() to authenticated, service_role;

-- 3. what the public pages return today, for every existing row ---------------
-- Deleted quotes and void invoices return null today and must still return null.
create temp table _0065_quote_before as
  select q.public_token as token, public.get_public_quote(q.public_token) as doc from public.quotes q;
create temp table _0065_invoice_before as
  select i.public_token as token, public.get_public_invoice(i.public_token) as doc from public.invoices i;

-- 4. the public functions -----------------------------------------------------
-- Live body read 2026-09-30 (pg_get_functiondef; it is the 0055 body). Only
-- the two keys after 'aircraft' are new.
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
    'aog', q.aog,
    'after_hours', q.after_hours,
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

-- Live body read 2026-09-30 (the 0055 body); only the two keys after
-- 'aircraft' are new. The '•••' mask characters are copied exactly.
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
    'aog', i.aog,
    'after_hours', i.after_hours,
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

-- 5. convert_quote_to_job carries the markers --------------------------------
-- Live body read 2026-09-30 (the 0043 body). ONLY the jobs INSERT changes: two
-- more columns, two more values. A car quote's are false (the CHECK above), so
-- a car job is inserted exactly as before. Still SECURITY INVOKER, still
-- idempotent, still callable headless by record_deposit_payment.
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
                    stage, stage_changed_at, aog, after_hours)
  values (v_quote.vehicle_id, shop_today(), v_quote.title, v_quote.description,
          v_quote.labor_hours, v_quote.labor_rate_cents,
          'From quote ' || v_quote.quote_number,
          'scheduled', now(), v_quote.aog, v_quote.after_hours)
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
revoke all on function public.convert_quote_to_job(uuid) from public, anon;
grant execute on function public.convert_quote_to_job(uuid) to authenticated, service_role;

-- 6. guard: existing documents did not change, or roll everything back --------
-- Every existing key and value is byte-identical; the two new keys read false
-- on every existing row that returns a document; no existing row carries a
-- marker; anon holds nothing on the six new columns; and the trigger and the
-- convert body are the ones above. Both sides drop the two new keys: on a
-- first run "before" has neither (a no-op), on a re-run it has both.
do $$
declare
  n int;
begin
  select count(*) into n from _0065_quote_before b
   where (public.get_public_quote(b.token) - 'aog' - 'after_hours')
         is distinct from (b.doc - 'aog' - 'after_hours');
  if n <> 0 then
    raise exception '0065: get_public_quote output changed for % existing quote(s) - rolling back', n;
  end if;
  select count(*) into n from _0065_invoice_before b
   where (public.get_public_invoice(b.token) - 'aog' - 'after_hours')
         is distinct from (b.doc - 'aog' - 'after_hours');
  if n <> 0 then
    raise exception '0065: get_public_invoice output changed for % existing invoice(s) - rolling back', n;
  end if;
  select count(*) into n from (
    select public.get_public_quote(b.token) as o from _0065_quote_before b where b.doc is not null
    union all
    select public.get_public_invoice(b.token) from _0065_invoice_before b where b.doc is not null) s
   where (s.o->'aog') is distinct from 'false'::jsonb
      or (s.o->'after_hours') is distinct from 'false'::jsonb;
  if n <> 0 then
    raise exception '0065: % existing public document(s) do not read aog / after_hours false - rolling back', n;
  end if;
  select count(*) into n from (
    select aog, after_hours from public.quotes
    union all select aog, after_hours from public.jobs
    union all select aog, after_hours from public.invoices) s
   where s.aog or s.after_hours;
  if n <> 0 then
    raise exception '0065: % existing row(s) carry a marker - rolling back', n;
  end if;
  -- A REVOKE can be a silent no-op (grantor mismatch), so assert the end state.
  select count(*) into n
    from (values ('public.quotes'), ('public.jobs'), ('public.invoices')) t(tbl)
    cross join (values ('aog'), ('after_hours')) c(col)
   where has_column_privilege('anon', t.tbl, c.col, 'SELECT, INSERT, UPDATE, REFERENCES');
  if n <> 0 then
    raise exception '0065: anon holds a privilege on % of the new columns - rolling back', n;
  end if;
  if (select pg_get_triggerdef(t.oid) from pg_trigger t
       where t.tgname = 'invoices_paper_frozen' and t.tgrelid = 'public.invoices'::regclass)
     not like '%BEFORE UPDATE OF service_line, aircraft, aog, after_hours ON public.invoices%' then
    raise exception '0065: invoices_paper_frozen does not list the two markers - rolling back';
  end if;
  if position('v_quote.aog, v_quote.after_hours' in
       pg_get_functiondef('public.convert_quote_to_job(uuid)'::regprocedure)) = 0 then
    raise exception '0065: convert_quote_to_job does not carry the markers - rolling back';
  end if;
end;
$$;
drop table _0065_quote_before;
drop table _0065_invoice_before;

-- Verify after applying (read-only):
--   select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and column_name in ('aog', 'after_hours')
--      and table_name in ('quotes', 'jobs', 'invoices') order by 1, 2;      -- 6 rows: boolean, NO, false
--   select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('quotes_aog_after_hours_check', 'invoices_aog_after_hours_check');
--     -- 2 rows: CHECK (((service_line = 'aviation'::text) OR (NOT (aog OR after_hours))))
--   select pg_get_triggerdef(oid) from pg_trigger where tgname = 'invoices_paper_frozen';
--     -- ... BEFORE UPDATE OF service_line, aircraft, aog, after_hours ON public.invoices ...
--   select proname, proacl from pg_proc where proname in ('get_public_quote', 'get_public_invoice',
--     'invoices_paper_frozen', 'convert_quote_to_job');
--     -- get_public_*: anon, authenticated, service_role (+ postgres). invoices_paper_frozen and
--     -- convert_quote_to_job: authenticated, service_role (+ postgres); no anon, no PUBLIC (=X/).
--   select position('v_quote.aog, v_quote.after_hours' in
--            pg_get_functiondef('public.convert_quote_to_job(uuid)'::regprocedure)) > 0;   -- true
--   select pg_get_functiondef('public.apply_quote_to_job(uuid)'::regprocedure) like '%aog%';  -- false: untouched
--   select (select count(*) from quotes where aog or after_hours) q, (select count(*) from jobs where aog or after_hours) j,
--          (select count(*) from invoices where aog or after_hours) i;          -- 0 / 0 / 0
--   select (select count(*) from vehicles) v, (select count(*) from jobs) j,
--          (select count(*) from quotes) q, (select count(*) from invoices) i;  -- 13 / 15 / 10 / 12
--   select last_value from invoice_number_seq; -- 19   job_number_seq -- 16   quote_number_seq -- 11
--
-- PROOF (by hand; ends with RAISE so nothing survives). Explicit numbers so no
-- sequence moves: convert_quote_to_job takes the job number from the column
-- default, so the proof points that default at a ZZ number first - an ALTER
-- the final RAISE rolls back with everything else (it holds a lock on jobs for
-- the milliseconds the block runs).
-- Expected: ERROR: PROOF OK - rolled back. Any "FAIL:" names the rule that broke.
--   do $proof$
--   declare c uuid; air uuid; car uuid; q uuid; qc uuid; j uuid; jc uuid; ja uuid; inv uuid; invc uuid; d jsonb;
--   begin
--     insert into customers (name) values ('ZZ PROOF 0065') returning id into c;
--     insert into vehicles (customer_id, service_line, registration, serial_number, make, model)
--       values (c, 'aviation', 'ZZTEST', 'SN-TEST', 'Make', 'Model') returning id into air;
--     insert into vehicles (customer_id, make, model) values (c, 'Make', 'Car') returning id into car;
--     -- a car quote refuses a marker: on insert, on update, and with no vehicle at all
--     begin insert into quotes (quote_number, customer_id, vehicle_id, title, aog) values ('ZZ-Q0065x', c, car, 'P', true);
--       raise exception 'FAIL: car quote took AOG'; exception when check_violation then
--         if sqlerrm not like '%quotes_aog_after_hours_check%' then raise; end if; end;
--     insert into quotes (quote_number, customer_id, vehicle_id, title) values ('ZZ-Q0065c', c, car, 'P') returning id into qc;
--     begin update quotes set after_hours = true where id = qc;
--       raise exception 'FAIL: car quote took nights'; exception when check_violation then
--         if sqlerrm not like '%quotes_aog_after_hours_check%' then raise; end if; end;
--     begin insert into quotes (quote_number, customer_id, title, after_hours) values ('ZZ-Q0065n', c, 'P', true);
--       raise exception 'FAIL: vehicleless car quote took nights'; exception when check_violation then
--         if sqlerrm not like '%quotes_aog_after_hours_check%' then raise; end if; end;
--     -- an aircraft quote takes both (its paper follows the vehicle even when sent up as automotive)
--     insert into quotes (quote_number, customer_id, vehicle_id, title, service_line, aog, after_hours)
--       values ('ZZ-Q0065', c, air, 'Proof', 'automotive', true, true) returning id into q;
--     select get_public_quote(public_token) into d from quotes where id = q;
--     if d->'aog' is distinct from 'true'::jsonb or d->'after_hours' is distinct from 'true'::jsonb
--       then raise exception 'FAIL: public quote markers %', d; end if;
--     select get_public_quote(public_token) into d from quotes where id = qc;
--     if d->'aog' is distinct from 'false'::jsonb or d->'after_hours' is distinct from 'false'::jsonb
--       then raise exception 'FAIL: car public quote markers %', d; end if;
--     -- a marked draft can't be moved onto a car: its paper would say AOG
--     begin update quotes set vehicle_id = car where id = q;
--       raise exception 'FAIL: marked quote moved to a car'; exception when check_violation then
--         if sqlerrm not like '%quotes_aog_after_hours_check%' then raise; end if; end;
--     -- the markers ride from the quote onto the job it becomes; a car's stay false
--     alter table public.jobs alter column job_number set default 'ZZ-J0065a';
--     j := convert_quote_to_job(q);
--     alter table public.jobs alter column job_number set default 'ZZ-J0065c';
--     jc := convert_quote_to_job(qc);
--     if not exists (select 1 from jobs where id = j and aog and after_hours)
--       then raise exception 'FAIL: converted aircraft job lost its markers'; end if;
--     if not exists (select 1 from jobs where id = jc and not aog and not after_hours)
--       then raise exception 'FAIL: converted car job gained a marker'; end if;
--     if (select job_number from jobs where id = j) is distinct from 'ZZ-J0065a'
--       then raise exception 'FAIL: proof job took a real number'; end if;
--     -- a car invoice refuses a marker, on insert and on update
--     begin insert into invoices (invoice_number, job_id, customer_id, customer_name, aog)
--       values ('ZZ-INV0065x', jc, c, 'x', true);
--       raise exception 'FAIL: car invoice took AOG'; exception when check_violation then
--         if sqlerrm not like '%invoices_aog_after_hours_check%' then raise; end if; end;
--     insert into invoices (invoice_number, job_id, customer_id, customer_name, total_cents)
--       values ('ZZ-INV0065c', jc, c, 'ZZ PROOF 0065', 10000) returning id into invc;
--     begin update invoices set after_hours = true where id = invc;
--       raise exception 'FAIL: car invoice took nights'; exception when check_violation then
--         if sqlerrm not like '%invoices_aog_after_hours_check%' then raise; end if; end;
--     select get_public_invoice(public_token) into d from invoices where id = invc;
--     if d->'aog' is distinct from 'false'::jsonb or d->'after_hours' is distinct from 'false'::jsonb
--       then raise exception 'FAIL: car public invoice markers %', d; end if;
--     -- an aviation draft may change its markers; once issued it may not
--     insert into invoices (invoice_number, job_id, customer_id, customer_name, vehicle_label, service_line,
--                           aircraft, aog, total_cents)
--       values ('ZZ-INV0065', j, c, 'ZZ PROOF 0065', 'ZZTEST · Make Model', 'aviation',
--               '{"registration":"ZZTEST","serial_number":"SN-TEST","airframe_hours":null}', true, 10000)
--       returning id into inv;
--     update invoices set after_hours = true where id = inv;
--     select get_public_invoice(public_token) into d from invoices where id = inv;
--     if d->'aog' is distinct from 'true'::jsonb or d->'after_hours' is distinct from 'true'::jsonb
--       then raise exception 'FAIL: public invoice markers %', d; end if;
--     update invoices set status = 'sent', sent_at = now() where id = inv;
--     begin update invoices set aog = false where id = inv;
--       raise exception 'FAIL: issued invoice dropped AOG';
--       exception when raise_exception then if sqlerrm <> 'invoice_paper_frozen' then raise; end if; end;
--     begin update invoices set after_hours = false where id = inv;
--       raise exception 'FAIL: issued invoice dropped nights';
--       exception when raise_exception then if sqlerrm <> 'invoice_paper_frozen' then raise; end if; end;
--     -- the 0055 freeze still holds
--     begin update invoices set aircraft = null where id = inv;
--       raise exception 'FAIL: issued aircraft changed';
--       exception when raise_exception then if sqlerrm <> 'invoice_paper_frozen' then raise; end if; end;
--     -- an add-on marked differently lands on the job and leaves the job's own markers alone
--     -- (apply_quote_to_job untouched)
--     insert into jobs (job_number, vehicle_id, title, stage, aog) values ('ZZ-J0065b', air, 'P', 'done', true)
--       returning id into ja;
--     insert into quotes (quote_number, customer_id, vehicle_id, title, status, job_id, after_hours)
--       values ('ZZ-Q0065b', c, air, 'Add-on', 'approved', ja, true) returning id into q;
--     perform apply_quote_to_job(q);
--     if not exists (select 1 from jobs where id = ja and aog and not after_hours)
--       then raise exception 'FAIL: add-on re-marked the job'; end if;
--     raise exception 'PROOF OK - rolled back';
--   end $proof$;
--   -- then: select last_value from invoice_number_seq / job_number_seq / quote_number_seq; -- still 19 / 16 / 11
--   --       select column_default from information_schema.columns
--   --        where table_schema = 'public' and table_name = 'jobs' and column_name = 'job_number';
--   --        -- still ('J'::text || lpad((nextval('job_number_seq'::regclass))::text, 3, '0'::text))
--
-- UNDO (loses every marker set since):
--   0. BEFORE applying, save the prior bodies:
--        select pg_get_functiondef(p) from (values ('public.get_public_quote(uuid)'::regprocedure),
--          ('public.get_public_invoice(uuid)'::regprocedure), ('public.invoices_paper_frozen()'::regprocedure),
--          ('public.convert_quote_to_job(uuid)'::regprocedure)) t(p);
--   1. re-run those four saved bodies (FIRST: the two SQL functions name the columns), then restate
--      their grants as above.
--   2. drop trigger if exists invoices_paper_frozen on public.invoices;
--      create trigger invoices_paper_frozen before update of service_line, aircraft on public.invoices
--        for each row execute function public.invoices_paper_frozen();
--   3. alter table public.invoices drop constraint if exists invoices_aog_after_hours_check,
--        drop column if exists aog, drop column if exists after_hours;
--      alter table public.quotes drop constraint if exists quotes_aog_after_hours_check,
--        drop column if exists aog, drop column if exists after_hours;
--      alter table public.jobs drop column if exists aog, drop column if exists after_hours;
