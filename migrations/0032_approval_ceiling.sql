-- 0032: never bill past what the customer approved - and when it happens,
-- two lawful ways out.
--
-- Alaska's Automobile Repair Act (AS 45.45.140 / .170) allows NO charge over
-- an approved estimate without the customer's OK, given before the extra is
-- incurred and recorded with the date, time, person and phone number called.
-- Without that OK the shop does the work at the estimated price. Measured
-- 2026-09-11: J003 sat at $2,075.03 before tax against $1,554.84 approved,
-- and nothing in the app would have stopped its invoice.
--
-- The estimate is the TOTAL price of the repair (labor + parts, before tax),
-- not a per-line promise: INV-008 came in under Q003 because labor fell from
-- 3.0 to 2.0 hours even though parts went up. So the check compares totals.
--
--   * job_authorized_totals - per job: what the customer approved (every
--     approved quote applied to it, plus each recorded OK's increase) and
--     what the job adds up to now.
--   * job_authorizations + record_job_ok - an OK taken by phone, in person or
--     by text, with the fields .170(d) lists.
--   * apply_billing_plan - "bill the approved amount": lowers charges back to
--     what was approved (never raises one), moves tax typed as a part onto
--     its receipt, and takes whatever is still over off as ONE visible
--     adjustment line.
--   * quote lines freeze once their quote is applied, so an approved baseline
--     rebuilt from them (Q001/Q003/Q004 predate approval snapshots) can't move.
--   * part_lines.condition - AS 45.45.190: the invoice identifies each part as
--     new, used, rebuilt or reconditioned.
--   * the customer statement shows the largest live invoice, never the sum
--     (invoices are whole-job revisions), and never more than was approved.

-- ------------------------------------------------------------ approved total

-- The pre-tax total an approval snapshot froze. Works on both shapes: the
-- online snapshot (respond_public_quote) and the offline one written by
-- "Record approval" - both carry labor_hours, labor_rate_cents and lines with
-- line_total_cents + declined.
create or replace function public.snapshot_pre_tax_cents(s jsonb)
returns integer
language sql
immutable
as $$
  select (
    round(coalesce((s->>'labor_hours')::numeric, 0) * coalesce((s->>'labor_rate_cents')::numeric, 0))
    + coalesce((
        select sum((l->>'line_total_cents')::numeric)
          from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) l
         where not coalesce((l->>'declined')::boolean, false)
      ), 0)
  )::integer
$$;

-- --------------------------------------------------------- recorded OKs

create table if not exists public.job_authorizations (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.jobs(id),
  previous_ceiling_cents  integer not null,
  new_total_cents         integer not null,
  delta_cents             integer generated always as (new_total_cents - previous_ceiling_cents) stored,
  description             text not null check (btrim(description) <> ''),
  method                  text not null check (method in ('phone', 'in_person', 'text')),
  by_name                 text not null check (btrim(by_name) <> ''),
  phone_called            text,
  authorized_at           timestamptz not null,
  recorded_at             timestamptz not null default now(),
  constraint job_authorizations_phone_needs_number
    check (method <> 'phone' or btrim(coalesce(phone_called, '')) <> ''),
  constraint job_authorizations_not_in_future
    check (authorized_at <= recorded_at + interval '5 minutes'),
  constraint job_authorizations_never_lowers
    check (new_total_cents >= previous_ceiling_cents)
);

comment on table public.job_authorizations is
  'A customer OK to go past the approved estimate, taken outside the quote link (AS 45.45.170(d)): who, how, the number called, when, and the new pre-tax total. One row per OK.';

create index if not exists job_authorizations_job_idx on public.job_authorizations (job_id);

alter table public.job_authorizations enable row level security;
drop policy if exists owner_all on public.job_authorizations;
create policy owner_all on public.job_authorizations
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.job_authorizations from anon;

-- ------------------------------------------------------ job_authorized_totals
-- Built FROM jobs with security_invoker, so row-level security applies to
-- whoever reads it (anon gets nothing). Scalar subqueries only - a join to a
-- one-to-many table multiplies sums (the 0027 lesson).
--
--   checked          - the job came from a quote (any applied quote, even a
--                      trashed one: trashing a quote must not erase the
--                      approval it carried)
--   quoted_cents     - approved quotes applied to the job, pre-tax, from
--                      their frozen snapshot, else rebuilt from their (now
--                      frozen) lines via quote_totals
--   reconstructed    - at least one approval has no snapshot on file
--   ok_delta_cents   - increases the customer OK'd since
--   authorized_cents - quoted + OKs
--   current_cents    - what the job adds up to now (job_totals)

create or replace view public.job_authorized_totals
with (security_invoker = true) as
select j.id as job_id,
       a.checked,
       a.quoted_cents,
       a.reconstructed,
       a.ok_delta_cents,
       a.quoted_cents + a.ok_delta_cents                   as authorized_cents,
       c.current_cents,
       c.current_cents - (a.quoted_cents + a.ok_delta_cents) as over_cents
  from public.jobs j
  cross join lateral (
    select
      exists (select 1 from public.quotes q
               where q.job_id = j.id and q.applied_at is not null) as checked,
      coalesce((
        select sum(coalesce(public.snapshot_pre_tax_cents(q.approved_snapshot),
                            t.labor_cents + t.lines_cents))
          from public.quotes q
          join public.quote_totals t on t.quote_id = q.id
         where q.job_id = j.id and q.applied_at is not null and q.status = 'approved'
      ), 0)::integer as quoted_cents,
      exists (select 1 from public.quotes q
               where q.job_id = j.id and q.applied_at is not null
                 and q.status = 'approved' and q.approved_snapshot is null) as reconstructed,
      coalesce((select sum(ja.delta_cents) from public.job_authorizations ja
                 where ja.job_id = j.id), 0)::integer as ok_delta_cents
  ) a
  cross join lateral (
    select coalesce((select jt.total_charged_cents from public.job_totals jt
                      where jt.job_id = j.id), 0) as current_cents
  ) c;

revoke all on public.job_authorized_totals from anon;
grant select on public.job_authorized_totals to authenticated;

-- ------------------------------------------------------------- record_job_ok

create or replace function public.record_job_ok(
  p_job_id uuid,
  p_new_total_cents integer,
  p_description text,
  p_method text,
  p_by_name text,
  p_phone text,
  p_authorized_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prev integer;
  v_id   uuid;
begin
  perform 1 from jobs where id = p_job_id and deleted_at is null for update;
  if not found then
    raise exception 'job not found';
  end if;
  select authorized_cents into v_prev from job_authorized_totals where job_id = p_job_id;
  if p_new_total_cents < v_prev then
    raise exception 'an OK can''t lower the approved total - bill less instead';
  end if;
  insert into job_authorizations (job_id, previous_ceiling_cents, new_total_cents, description,
                                  method, by_name, phone_called, authorized_at)
  values (p_job_id, v_prev, p_new_total_cents, btrim(p_description), p_method, btrim(p_by_name),
          nullif(btrim(coalesce(p_phone, '')), ''), coalesce(p_authorized_at, now()))
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.record_job_ok(uuid, integer, text, text, text, text, timestamptz) from public;
revoke all on function public.record_job_ok(uuid, integer, text, text, text, text, timestamptz) from anon;
grant execute on function public.record_job_ok(uuid, integer, text, text, text, text, timestamptz) to authenticated;

-- ------------------------------------------ quote lines freeze once applied

create or replace function public.quote_lines_frozen_once_applied()
returns trigger
language plpgsql
as $$
declare
  v_applied timestamptz;
begin
  select applied_at into v_applied
    from public.quotes
   where id = case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
  if v_applied is not null then
    raise exception 'this quote''s lines are already on a job - change the job instead';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists quote_lines_frozen_once_applied on public.quote_lines;
create trigger quote_lines_frozen_once_applied
  before insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_frozen_once_applied();

-- ------------------------------------------------ part_lines: adjustment, condition

alter table public.part_lines
  add column if not exists is_adjustment boolean not null default false,
  add column if not exists condition text;

alter table public.part_lines
  drop constraint if exists part_lines_condition_check,
  add constraint part_lines_condition_check
    check (condition is null or condition in ('new', 'used', 'rebuilt', 'reconditioned', 'not_part'));

comment on column public.part_lines.is_adjustment is
  'The one "Adjustment to approved estimate" line apply_billing_plan keeps per job.';
comment on column public.part_lines.condition is
  'AS 45.45.190: new / used / rebuilt / reconditioned, or not_part for fees and freight. Null = not confirmed yet; confirmed before an invoice is made.';

create unique index if not exists part_lines_one_adjustment_per_job
  on public.part_lines (job_id) where is_adjustment;

-- -------------------------------------------------------- apply_billing_plan
-- p_ops is a list of explicit steps the owner reviewed on screen:
--   { op: 'set_charge', line_id, unit_charge_cents, quote_line_id? }
--   { op: 'move_tax',   line_id }   - counter tax typed as a part
--   { op: 'cost_only',  line_id }   - off the bill, the shop's own cost
-- Then whatever is still over the approval comes off as one adjustment line.

create or replace function public.apply_billing_plan(p_job_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
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

  select current_cents into v_before from job_authorized_totals where job_id = p_job_id;

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
      values (p_job_id, 'Adjustment to approved estimate', 1, 0, -v_over, true, 'not_part');
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
grant execute on function public.apply_billing_plan(uuid, jsonb) to authenticated;

-- ------------------------------------------- the authorization trail on invoices

alter table public.invoices
  add column if not exists authorizations jsonb not null default '[]'::jsonb;

comment on column public.invoices.authorizations is
  'The approvals behind this bill, frozen with the invoice (AS 45.45.170(d)): quote approvals and recorded OKs - who, how, when, the number called, the pre-tax amount.';

-- get_public_invoice: same as 0020 plus the trail, with the number called
-- masked to its last four digits on the public link (it may be a spouse's or
-- an employer's line, and links get forwarded).
create or replace function public.get_public_invoice(token uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
$function$;

-- ---------------------------------------------------------- the statement
-- The live definition (never in a migration until now) with two changes:
-- each job's total is the LARGEST live invoice, never the sum - invoices
-- snapshot the whole job, so two live ones are revisions of one debt; and a
-- quoted job with no invoice yet never shows more than was approved.

create or replace function public.get_public_statement(token uuid)
returns jsonb
language sql
stable security definer
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
            case when a.checked then least(t.total_charged_cents, a.authorized_cents)
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
