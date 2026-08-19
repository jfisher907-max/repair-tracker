-- Review hardening for the atomic apply (findings from the 47af6d2 review).
--
-- 1. apply_quote_to_job now respects a parts-charged override: on jobs where
--    the owner pinned "parts charged" to a number, every totals source
--    ignores line charges - so approved add-on parts were landing on the job
--    while billing $0. When an override exists, it grows by the approved
--    lines' charge total; jobs without an override are untouched (null stays
--    null and the new lines price normally).
--
-- 2. respond_public_quote refuses a response once the quote has been applied
--    to a job: the work already landed, so a late tap on a stale /q page must
--    not flip the status or rewrite declined flags underneath it.

create or replace function public.apply_quote_to_job(p_quote_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  q record;
  j record;
  scope_note text;
  approved_charges integer;
begin
  select * into q from quotes where id = p_quote_id and deleted_at is null for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.job_id is null then raise exception 'This quote is not linked to a job'; end if;
  if q.applied_at is not null then raise exception 'This quote was already applied'; end if;

  select * into j from jobs where id = q.job_id and deleted_at is null for update;
  if not found then raise exception 'The job this quote belongs to no longer exists'; end if;

  if q.status <> 'declined' then
    insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents)
    select q.job_id, l.description, l.qty, 0, l.unit_charge_cents
    from quote_lines l
    where l.quote_id = q.id and not l.declined;

    select coalesce(sum(l.line_total_cents), 0) into approved_charges
    from quote_lines l
    where l.quote_id = q.id and not l.declined;

    scope_note := '+ ' || q.title || ' (authorized via ' || q.quote_number || ')';
    update jobs set
      labor_hours = j.labor_hours + q.labor_hours,
      work_performed = case
        when j.work_performed is null or j.work_performed = '' then scope_note
        else j.work_performed || E'\n' || scope_note
      end,
      -- A pinned parts-charged figure must grow by what the customer just
      -- approved, or the new lines exist without ever reaching the bill.
      parts_charged_override_cents = case
        when j.parts_charged_override_cents is null then null
        else j.parts_charged_override_cents + approved_charges
      end
    where id = j.id;
  end if;

  insert into recommendations (job_id, vehicle_id, description, estimate_cents, status)
  select q.job_id, q.vehicle_id,
         l.description || ' (declined on ' || q.quote_number || ')',
         l.line_total_cents, 'open'
  from quote_lines l
  where l.quote_id = q.id and (l.declined or q.status = 'declined');

  update quotes set applied_at = now() where id = q.id;
end
$$;

-- Same function as 0007 with ONE new condition: "and applied_at is null".
create or replace function public.respond_public_quote(
  token uuid, response text,
  p_name text default null, p_consent boolean default null,
  p_ip text default null, p_user_agent text default null,
  p_declined_ids uuid[] default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quote    record;
  v_declined uuid[];
  v_labor    integer;
  v_parts    integer;
  v_tax      integer;
  v_snapshot jsonb;
  new_status text;
begin
  if response not in ('approved', 'declined') then
    return null;
  end if;

  select * into v_quote
    from quotes
   where public_token = token and status = 'sent'
     and applied_at is null and deleted_at is null;

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
         approved_snapshot   = v_snapshot
   where id = v_quote.id
   returning status into new_status;

  return new_status;
end
$function$;
