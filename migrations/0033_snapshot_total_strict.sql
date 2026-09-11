-- 0033: fix 0032. snapshot_pre_tax_cents must return NULL for a missing
-- snapshot.
--
-- As 0032 wrote it, a NULL snapshot came back as 0 (every term coalesced to
-- zero), so coalesce(snapshot_pre_tax_cents(...), quote_totals fallback) never
-- fell back for the three approvals that predate snapshots (Q001, Q003,
-- Q004). Their jobs read "approved $0", and get_public_statement - which now
-- caps a quoted job at its approved total - showed J003 at $0 for the few
-- minutes 0032 was live. Caught by the rolled-back test of 0032, in which a
-- "bill the approved amount" run took J003 down to $1.00; no real bill or
-- invoice was touched.
--
-- Also: apply_billing_plan now refuses a job whose approved total reads $0,
-- so a bad ceiling can never zero out a bill again.

create or replace function public.snapshot_pre_tax_cents(s jsonb)
returns integer
language sql
immutable
strict
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
