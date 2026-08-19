-- Applying an add-on quote to its job becomes one transaction.
--
-- The client-side version was four sequential writes guarded by in-memory
-- refs; a reload after a partial failure reset the refs while applied_at was
-- still null, and re-tapping Apply duplicated part lines and labor hours
-- straight onto the customer's bill. A plpgsql function is atomic: all of it
-- lands or none of it does, and the FOR UPDATE row locks make double-taps
-- (or two tabs) serialize on the applied_at guard.
--
-- SECURITY INVOKER on purpose: this runs as the signed-in owner and relies
-- on the tables' normal RLS - it grants nothing anon can reach.

create or replace function public.apply_quote_to_job(p_quote_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  q record;
  j record;
  scope_note text;
begin
  select * into q from quotes where id = p_quote_id and deleted_at is null for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.job_id is null then raise exception 'This quote is not linked to a job'; end if;
  if q.applied_at is not null then raise exception 'This quote was already applied'; end if;

  select * into j from jobs where id = q.job_id and deleted_at is null for update;
  if not found then raise exception 'The job this quote belongs to no longer exists'; end if;

  -- A fully declined quote contributes no work and no labor - only
  -- follow-ups. Everything else lands approved lines, labor, and the scope
  -- note on the job.
  if q.status <> 'declined' then
    insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents)
    select q.job_id, l.description, l.qty, 0, l.unit_charge_cents
    from quote_lines l
    where l.quote_id = q.id and not l.declined;

    scope_note := '+ ' || q.title || ' (authorized via ' || q.quote_number || ')';
    update jobs set
      labor_hours = j.labor_hours + q.labor_hours,
      work_performed = case
        when j.work_performed is null or j.work_performed = '' then scope_note
        else j.work_performed || E'\n' || scope_note
      end
    where id = j.id;
  end if;

  -- Declined lines (or all lines, when the whole quote was declined) become
  -- open recommendations with their quoted price, same as conversion does.
  insert into recommendations (job_id, vehicle_id, description, estimate_cents, status)
  select q.job_id, q.vehicle_id,
         l.description || ' (declined on ' || q.quote_number || ')',
         l.line_total_cents, 'open'
  from quote_lines l
  where l.quote_id = q.id and (l.declined or q.status = 'declined');

  update quotes set applied_at = now() where id = q.id;
end
$$;
