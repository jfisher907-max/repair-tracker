-- A job OK can be given by email (owner, 2026-11-15: "Yes, add it").
--
-- Estimates now go to email-only customers as an email (305bdbb), and a quote
-- approval can already be recorded as "by email" (d2b4284), because
-- quote_approvals.method is free text. An OK for work PAST the approved
-- estimate is held tighter: job_authorizations_method_check allows only phone,
-- in_person and text, and update_job_ok repeats that list. A customer who
-- replies "yes, go ahead" to an emailed revised estimate has given a written
-- OK, which AS 45.45.170(a) accepts alongside an oral one, so 'email' joins the
-- list in both places.
--
-- No number is required with it. job_authorizations_phone_needs_number is about
-- a phone call and is untouched; the email itself is the written record, and
-- the form tells the owner to keep it. record_job_ok has no list of its own (it
-- relies on the constraint), so it is untouched too.
--
-- Widening only: every row on file already passes the new check, and nothing
-- that was allowed before is refused after.

-- ── 1. The column's rule ─────────────────────────────────────────────

alter table public.job_authorizations
  drop constraint if exists job_authorizations_method_check;
alter table public.job_authorizations
  add constraint job_authorizations_method_check
  check (method in ('phone', 'in_person', 'text', 'email'));

-- ── 2. Correcting an OK ──────────────────────────────────────────────
-- The body is the live function as of 2026-11-15, with only the method list
-- and its sentence changed. create or replace keeps its owner and grants.

create or replace function public.update_job_ok(
  p_id uuid,
  p_authorized_at timestamp with time zone,
  p_by_name text,
  p_method text,
  p_phone text,
  p_description text,
  p_new_total_cents integer
)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
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

  if coalesce(p_method, '') not in ('phone', 'in_person', 'text', 'email') then
    raise exception 'say how the customer OK''d it: by phone, in person, by text, or by email';
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
  if p_authorized_at > v_ok.recorded_at + interval '5 minutes' then
    raise exception
      'this OK was written down on %, so it can''t have been given after that. Pick a time at or before then.',
      to_char(v_ok.recorded_at at time zone 'America/Anchorage', 'FMMon FMDD, YYYY')
        || ' at ' || to_char(v_ok.recorded_at at time zone 'America/Anchorage', 'FMHH12:MI AM');
  end if;

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
$function$;

-- ── 3. Prove the end state ───────────────────────────────────────────

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.job_authorizations'::regclass
     and conname = 'job_authorizations_method_check';
  if v_def is null or v_def not like '%''email''%' or v_def not like '%''in_person''%' then
    raise exception '0072: job_authorizations_method_check is %, expected phone/in_person/text/email', v_def;
  end if;
  if pg_get_functiondef('public.update_job_ok(uuid, timestamp with time zone, text, text, text, text, integer)'::regprocedure)
       not like '%''text'', ''email''%' then
    raise exception '0072: update_job_ok still refuses email';
  end if;
end $$;
