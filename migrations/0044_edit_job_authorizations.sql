-- 0044: a recorded OK can be corrected - and correcting one rebuilds the chain.
--
-- The owner recorded the wrong time on an OK. Today there is no way to fix it:
-- record_job_ok only ever inserts. AS 45.45.170(d) wants the date AND time of
-- the customer's OK on the invoice, so a wrong time that cannot be corrected is
-- worse than a corrected one - the goal of an edit is an ACCURATE record, not a
-- tidy one. So every edit is stamped: recorded_at keeps the moment the OK was
-- first written down (that is the honest record and it never moves), and
-- corrected_at shows the row was gone back over. Nothing here rewrites history
-- silently.
--
-- WHY A REBUILD IS MANDATORY.
--
-- job_authorizations is a CHAIN, not a list. Each row carries
-- previous_ceiling_cents and new_total_cents, delta_cents is GENERATED as
-- (new_total - previous_ceiling), and job_authorized_totals reads
--
--     authorized_cents = quoted_cents + sum(delta_cents)
--
-- With an intact chain the first row's previous_ceiling is the approved-quote
-- total and each later row's previous_ceiling is the row before it's new_total,
-- so the deltas telescope and authorized_cents lands exactly on the LAST row's
-- new_total. J014 measured 2026-09-14: Q008 approved 63309; OK1 new_total 87449
-- (prev 63309, delta 24140); OK2 new_total 100949 (prev 87449, delta 13500);
-- 63309 + 24140 + 13500 = 100949.
--
-- Break one link and the sum is silently wrong, which means the approved
-- CEILING is wrong, which means the invoice guard lets the shop bill past what
-- the customer agreed to (or holds it under). Deleting a row, changing an
-- amount, or changing a TIME so the rows reorder all break it. Therefore every
-- edit and every delete re-derives previous_ceiling for EVERY row on that job -
-- rebuild_job_ok_chain - rather than patching the row in front of it.
--
-- Two CHECKs a rebuild has to respect:
--   job_authorizations_never_lowers   new_total_cents >= previous_ceiling_cents
--   job_authorizations_not_in_future  authorized_at <= recorded_at + 5 min
-- Both are per-row CHECKs and neither is deferrable here. See the ordering note
-- on rebuild_job_ok_chain for why no intermediate state can trip the first one,
-- and the validation in update_job_ok for how the second is caught in plain
-- English before the constraint ever fires (house rule: the owner never reads a
-- constraint name).

-- ------------------------------------------------------------- corrected_at

alter table public.job_authorizations
  add column if not exists corrected_at timestamptz null;

comment on column public.job_authorizations.corrected_at is
  'The OK was written down at recorded_at and last gone back over at corrected_at. Null means it has never been corrected. recorded_at never changes on an edit - it is when the shop actually made the record.';

-- ------------------------------------------------------ WHERE THE CHAIN STARTS
-- The number the first OK's previous_ceiling must equal is
-- job_authorized_totals.quoted_cents - the SAME number the view adds the deltas
-- to. Nothing here re-derives it. There is deliberately no second copy of that
-- expression in this file: the whole correctness argument is that
-- authorized_cents telescopes to the last OK's new_total, and that holds only
-- while the chain's starting number and the view's summing number are one
-- number. Two copies would let the ceiling go quietly wrong with nothing
-- raised anywhere the day one of them changed. Reading the view is not
-- circular - quoted_cents is computed from quotes/quote_totals alone and never
-- touches job_authorizations - and the view has exactly one row for every job
-- (it is built `from public.jobs` with no deleted_at filter; 15 jobs, 15 rows,
-- 0 null quoted_cents, measured read-only 2026-09-14).

-- ------------------------------------------------------- job_ok_chain_breaks
-- How many OKs on a job come out UNDER the ceiling the chain gives them: the
-- same walk rebuild_job_ok_chain's pass 1 does, counted instead of raised.
--
-- On an intact chain this is 0 and stays 0. It can only be non-zero if the
-- approved-quote total rose ABOVE an OK already on file - a second quote
-- approved and applied to a job that already had OKs - which strands that OK
-- under the estimate. delete_job_ok uses this to tell "this delete clears, or
-- leaves alone, a break that was already there" from "this delete makes the
-- chain worse", so a stranded OK can still be taken off.

create or replace function public.job_ok_chain_breaks(p_job_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  with walk as (
    select a.new_total_cents,
           coalesce(
             lag(a.new_total_cents) over (order by a.authorized_at, a.recorded_at, a.id),
             (select t.quoted_cents from public.job_authorized_totals t where t.job_id = p_job_id)
           ) as ceiling_cents
      from public.job_authorizations a
     where a.job_id = p_job_id
  )
  select count(*)::integer from walk where new_total_cents < ceiling_cents
$$;

comment on function public.job_ok_chain_breaks(uuid) is
  'How many of a job''s OKs come out under the ceiling the chain gives them. 0 on an intact chain; non-zero only where an approved estimate rose above an OK already on file.';

revoke all on function public.job_ok_chain_breaks(uuid) from public;
revoke all on function public.job_ok_chain_breaks(uuid) from anon;
grant execute on function public.job_ok_chain_breaks(uuid) to authenticated;

-- --------------------------------------------------- rebuild_job_ok_chain
-- Re-derives previous_ceiling_cents for every OK on a job, in time order
-- (authorized_at, then recorded_at, then id so the order is total and stable):
-- the first row starts from the approved-quote total, each later row starts
-- from the row before it. new_total_cents is the owner's record of what the
-- customer agreed to and is NEVER touched here.
--
-- p_allow_existing_breaks - false everywhere an amount or a time just changed:
-- a row that would come out under its ceiling is the owner's mistake and it
-- raises. delete_job_ok passes true, having already proved the delete does not
-- make the chain worse (see there); a row that cannot take its new ceiling then
-- keeps the one it has, and every other row is still re-derived.
--
-- WHY THE UPDATE ORDER CANNOT TRIP never_lowers.
--
--   1. never_lowers is a row-level CHECK over two columns of the SAME row. It
--      says nothing about any other row, so a half-rebuilt table is not a state
--      it can object to - only an individual row can be wrong.
--   2. Pass 1 walks the whole chain and writes NOTHING. It compares each row's
--      new_total against the ceiling it will be given. If any row would come out
--      under its ceiling, it raises - naming that OK, its date and both amounts -
--      before a single byte moves.
--   3. So by the time pass 2 runs, every target has already been proved to
--      satisfy the CHECK, and each UPDATE writes exactly that target. Any single
--      row update therefore lands on a legal row no matter which order the rows
--      are written in. No deferred constraint, and no drop-and-recheck, needed.
--   4. Pass 2 re-tests the same comparison anyway before each write, so the
--      invariant holds structurally rather than by agreement between the two
--      passes - which is also what makes p_allow_existing_breaks safe: the only
--      row it declines to write is one whose existing ceiling already passes.
--   5. Belt and braces: the whole call is one transaction. A raise anywhere -
--      here or in the caller - rolls back every row this touched.
--
-- Returns how many rows the job's chain now has.

create or replace function public.rebuild_job_ok_chain(
  p_job_id uuid,
  p_allow_existing_breaks boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quoted integer;
  v_prev   integer;
  v_row    record;
  v_first  boolean;
  v_n      integer := 0;
begin
  -- One writer per job: the lock serializes concurrent edits so two rebuilds
  -- can never interleave on the same chain.
  perform 1 from jobs where id = p_job_id and deleted_at is null for update;
  if not found then
    raise exception 'that job is not on file';
  end if;

  -- Where the chain starts: the view's own number, read rather than re-derived.
  select quoted_cents into v_quoted from job_authorized_totals where job_id = p_job_id;
  if v_quoted is null then
    -- Cannot happen - the view has a row for every job - but a null here would
    -- make pass 1 compare against nothing and pass 2 write a NOT NULL ceiling,
    -- which would reach the owner as a constraint name.
    raise exception 'that job is not on file';
  end if;

  -- Pass 1 - prove the chain before writing any of it.
  v_prev  := v_quoted;
  v_first := true;
  for v_row in
    select id, description, authorized_at, new_total_cents
      from job_authorizations
     where job_id = p_job_id
     order by authorized_at, recorded_at, id
  loop
    if v_row.new_total_cents < v_prev and not p_allow_existing_breaks then
      if v_first then
        -- The break is against the ESTIMATE, not against another OK: the
        -- approved quotes now come to more than this OK ever did. No time and
        -- no amount the owner is allowed to type can clear that, so the message
        -- says the one thing that can.
        raise exception
          'The estimate on this job now approves $%, which is more than the $% OK "%" from %. That OK no longer belongs on the record - delete it.',
          to_char(v_prev / 100.0, 'FM999,990.00'),
          to_char(v_row.new_total_cents / 100.0, 'FM999,990.00'),
          v_row.description,
          to_char(v_row.authorized_at at time zone 'America/Anchorage', 'FMMon FMDD, YYYY')
            || ' at ' || to_char(v_row.authorized_at at time zone 'America/Anchorage', 'FMHH12:MI AM');
      end if;
      raise exception
        'The OK "%" from % comes to $%, but $% was already approved before it. An OK can never lower the approved total - check that OK''s time and its new total.',
        v_row.description,
        to_char(v_row.authorized_at at time zone 'America/Anchorage', 'FMMon FMDD, YYYY')
          || ' at ' || to_char(v_row.authorized_at at time zone 'America/Anchorage', 'FMHH12:MI AM'),
        to_char(v_row.new_total_cents / 100.0, 'FM999,990.00'),
        to_char(v_prev / 100.0, 'FM999,990.00');
    end if;
    v_prev  := v_row.new_total_cents;
    v_first := false;
  end loop;

  -- Pass 2 - write the proved ceilings.
  v_prev := v_quoted;
  for v_row in
    select id, new_total_cents
      from job_authorizations
     where job_id = p_job_id
     order by authorized_at, recorded_at, id
  loop
    -- A row that would come out under its ceiling keeps the ceiling it has:
    -- writing the new one would violate never_lowers, and the value already on
    -- the row passed that CHECK when it was written. In the default mode pass 1
    -- has proved this branch is never taken; under p_allow_existing_breaks it is
    -- what leaves an already-broken link exactly where it was.
    if v_row.new_total_cents >= v_prev then
      update job_authorizations
         set previous_ceiling_cents = v_prev
       where id = v_row.id
         and previous_ceiling_cents is distinct from v_prev;
    end if;
    v_prev := v_row.new_total_cents;
    v_n := v_n + 1;
  end loop;

  return v_n;
end
$$;

comment on function public.rebuild_job_ok_chain(uuid, boolean) is
  'Re-derives every OK''s previous_ceiling_cents on a job so the deltas telescope again, starting from job_authorized_totals.quoted_cents. Raises in plain English, naming the OK, if the amounts are not non-decreasing in time order - unless p_allow_existing_breaks, which leaves such a row''s ceiling alone instead.';

revoke all on function public.rebuild_job_ok_chain(uuid, boolean) from public;
revoke all on function public.rebuild_job_ok_chain(uuid, boolean) from anon;
grant execute on function public.rebuild_job_ok_chain(uuid, boolean) to authenticated;

-- --------------------------------------------------------------- update_job_ok
-- Correct a recorded OK. Same field rules as record_job_ok, plus:
--   * the job must still be editable - a SENT or PAID invoice already printed
--     this trail and an issued invoice never changes (the 0032 rule);
--   * recorded_at is left alone, corrected_at is stamped;
--   * the chain is rebuilt, so a corrected time that reorders the OKs, or a
--     corrected amount, cannot leave the approved ceiling wrong.
--
-- Returns the job and its approved ceiling after the correction, so the screen
-- can say what the total now stands at.

create or replace function public.update_job_ok(
  p_id uuid,
  p_authorized_at timestamptz,
  p_by_name text,
  p_method text,
  p_phone text,
  p_description text,
  p_new_total_cents integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ok    job_authorizations%rowtype;
  v_auth  integer;
begin
  select * into v_ok from job_authorizations where id = p_id;
  if not found then
    raise exception 'that OK is not on file any more';
  end if;

  perform 1 from jobs where id = v_ok.job_id and deleted_at is null for update;
  if not found then
    raise exception 'that job is not on file';
  end if;

  if exists (select 1 from invoices where job_id = v_ok.job_id and status in ('sent', 'paid')) then
    raise exception 'this job already has a sent or paid invoice - it printed this approval as it stands, and an issued invoice never changes. Void and reissue it instead.';
  end if;

  -- Field rules, in the owner's words. Every one of these is also a constraint
  -- on the table; saying it here is what keeps a constraint name off the screen.
  if coalesce(p_method, '') not in ('phone', 'in_person', 'text') then
    raise exception 'say how the customer OK''d it: by phone, in person, or by text';
  end if;
  if btrim(coalesce(p_by_name, '')) = '' then
    raise exception 'who gave the OK?';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'say what the customer OK''d';
  end if;
  if p_method = 'phone' and btrim(coalesce(p_phone, '')) = '' then
    raise exception 'a phone OK has to record the number you called';
  end if;
  if p_new_total_cents is null or p_new_total_cents < 0 then
    raise exception 'enter the new total the customer OK''d';
  end if;
  if p_authorized_at is null then
    raise exception 'when did the customer OK it?';
  end if;
  if p_authorized_at > now() + interval '5 minutes' then
    raise exception 'that time is in the future - an OK is recorded after the customer gives it';
  end if;
  -- job_authorizations_not_in_future compares against recorded_at, which an edit
  -- deliberately leaves alone. So the corrected time can move anywhere at or
  -- before the moment this OK was written down, and no further.
  if p_authorized_at > v_ok.recorded_at + interval '5 minutes' then
    raise exception
      'this OK was written down on %, so it can''t have been given after that. Pick a time at or before then.',
      to_char(v_ok.recorded_at at time zone 'America/Anchorage', 'FMMon FMDD, YYYY')
        || ' at ' || to_char(v_ok.recorded_at at time zone 'America/Anchorage', 'FMHH12:MI AM');
  end if;

  -- previous_ceiling_cents is written twice on purpose. Here it takes a value
  -- that CANNOT trip never_lowers on this statement (the old ceiling, or the new
  -- total if the owner lowered the amount below it); rebuild_job_ok_chain then
  -- replaces it with the real one, after proving the whole chain. Without this
  -- the CHECK would fire on the edit itself - with its own name on it - before
  -- the rebuild ever got a chance to run.
  update job_authorizations
     set authorized_at          = p_authorized_at,
         by_name                = btrim(p_by_name),
         method                 = p_method,
         phone_called           = nullif(btrim(coalesce(p_phone, '')), ''),
         description            = btrim(p_description),
         new_total_cents        = p_new_total_cents,
         previous_ceiling_cents = least(previous_ceiling_cents, p_new_total_cents),
         corrected_at           = now()
   where id = p_id;

  perform rebuild_job_ok_chain(v_ok.job_id);

  select authorized_cents into v_auth from job_authorized_totals where job_id = v_ok.job_id;
  return jsonb_build_object('id', p_id, 'job_id', v_ok.job_id, 'authorized_cents', v_auth);
end
$$;

revoke all on function public.update_job_ok(uuid, timestamptz, text, text, text, text, integer) from public;
revoke all on function public.update_job_ok(uuid, timestamptz, text, text, text, text, integer) from anon;
grant execute on function public.update_job_ok(uuid, timestamptz, text, text, text, text, integer) to authenticated;

-- --------------------------------------------------------------- delete_job_ok
-- An OK recorded against the wrong job, or twice. Taking one out lowers the
-- approved ceiling to the last OK left, so the chain is rebuilt the same way.
--
-- A delete is legal whenever it does not make the chain WORSE. On an intact
-- chain that is every delete - removing one link from a non-decreasing sequence
-- leaves it non-decreasing - so the rule only bites on a chain that was already
-- broken: an OK stranded under an estimate that later rose above it. There, the
-- rebuild's proof would refuse EVERY delete on the job, including the delete of
-- the offending OK itself, and the owner would be left with an OK he can
-- neither correct nor take off - the escape hatch bolted shut. So this counts
-- the breaks, deletes, counts again, and refuses only if the number went UP.
-- Then the rebuild runs in the mode that leaves a pre-existing break where it
-- is, and the owner clears a stranded chain one row at a time.

create or replace function public.delete_job_ok(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ok     job_authorizations%rowtype;
  v_auth   integer;
  v_before integer;
  v_after  integer;
begin
  select * into v_ok from job_authorizations where id = p_id;
  if not found then
    raise exception 'that OK is not on file any more';
  end if;

  perform 1 from jobs where id = v_ok.job_id and deleted_at is null for update;
  if not found then
    raise exception 'that job is not on file';
  end if;

  if exists (select 1 from invoices where job_id = v_ok.job_id and status in ('sent', 'paid')) then
    raise exception 'this job already has a sent or paid invoice - it printed this approval as it stands, and an issued invoice never changes. Void and reissue it instead.';
  end if;

  v_before := job_ok_chain_breaks(v_ok.job_id);

  delete from job_authorizations where id = p_id;

  v_after := job_ok_chain_breaks(v_ok.job_id);
  if v_after > v_before then
    raise exception
      'taking that OK out would leave another OK on this job under the total already approved before it - correct or delete that one first';
  end if;

  -- true because the count above has already proved this delete does not make
  -- the chain worse; without it a job with one stranded OK could never be
  -- cleared through the app at all.
  perform rebuild_job_ok_chain(v_ok.job_id, true);

  select authorized_cents into v_auth from job_authorized_totals where job_id = v_ok.job_id;
  return jsonb_build_object('job_id', v_ok.job_id, 'authorized_cents', v_auth);
end
$$;

revoke all on function public.delete_job_ok(uuid) from public;
revoke all on function public.delete_job_ok(uuid) from anon;
grant execute on function public.delete_job_ok(uuid) to authenticated;

-- ------------------------------------------------------------- verification
-- 1. The chain telescopes on every job: each OK's previous_ceiling is the one
--    before it, and the first one's is the view's quoted_cents. Expect zero rows.
--
-- with chain as (
--   select a.job_id, a.id, a.description, a.previous_ceiling_cents, a.new_total_cents,
--          lag(a.new_total_cents) over (partition by a.job_id order by a.authorized_at, a.recorded_at, a.id) as prev_new
--     from public.job_authorizations a
-- )
-- select j.job_number, c.description, c.previous_ceiling_cents,
--        coalesce(c.prev_new, v.quoted_cents) as should_be
--   from chain c
--   join public.jobs j on j.id = c.job_id
--   join public.job_authorized_totals v on v.job_id = c.job_id
--  where c.previous_ceiling_cents is distinct from coalesce(c.prev_new, v.quoted_cents);
--
-- select j.job_number, public.job_ok_chain_breaks(j.id) as breaks
--   from public.jobs j where public.job_ok_chain_breaks(j.id) > 0;
--
-- 2. After correcting an OK, the row shows it: recorded_at unchanged,
--    corrected_at set.
--
-- select description, authorized_at, recorded_at, corrected_at,
--        previous_ceiling_cents, new_total_cents, delta_cents
--   from public.job_authorizations
--  where job_id = (select id from public.jobs where job_number = 'J014')
--  order by authorized_at;
--
-- ---------------------------------------------------------------------- undo
-- drop function if exists public.update_job_ok(uuid, timestamptz, text, text, text, text, integer);
-- drop function if exists public.delete_job_ok(uuid);
-- drop function if exists public.rebuild_job_ok_chain(uuid, boolean);
-- drop function if exists public.job_ok_chain_breaks(uuid);
-- alter table public.job_authorizations drop column if exists corrected_at;
--
-- Two things the undo does NOT put back: which rows had been corrected (that
-- lives only in corrected_at), and any previous_ceiling_cents a rebuild has
-- already rewritten. The second is not a loss - a rebuild of an intact chain
-- writes nothing (verified read-only against all three live OKs, 2026-09-14),
-- and where it did write, the old value was the broken one.
