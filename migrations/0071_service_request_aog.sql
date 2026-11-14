-- 0071: AOG on a service request — the customer can say the aircraft is down.
--
-- The owner (2026-11-14): "I want there to be a check box for customers to
-- select if their aircraft is AOG and when that box is selected, I want some
-- type of push notification/email/text sent to my phone about the request."
--
-- AOG is NOT a new idea here. 0065 already put `aog` on quotes, jobs and
-- invoices as a paper marker that never changes the labor rate, and carries
-- it quote -> job -> invoice. What was missing is the INTAKE: the request
-- form had no way to say it, so an aircraft on the ground arrived looking
-- exactly like a tire rotation. This column is that marker one step earlier,
-- and a quote written from the request can carry it on (0065's columns).
--
-- Aviation only, the same shape as quotes_aog_after_hours_check (0065):
-- `service_line = 'aviation' or not aog`. A car is never AOG, and the term
-- means nothing off an aircraft.
--
-- WHY THE FUNCTION ALSO FORCES IT. The column is written through
-- submit_service_request, which is SECURITY DEFINER and reachable only by
-- service_role (0025) — but the ARGUMENTS come from an unauthenticated web
-- form, and this is the first field on that form that makes the owner's
-- phone ring. v_aog therefore ANDs the caller's flag with the line the
-- function itself derived, so a tampered payload claiming aog on an
-- automotive request stores false instead of raising. The CHECK above is the
-- backstop, not the gate.
--
-- THE 'page' FLAG IS AN ABUSE BRAKE, NOT A RATE LIMIT. The existing brakes
-- (5/hour and 10/day per IP, 200/day for the shop) already cap the form, and
-- they still apply — a refused request is never stored and never pages. But
-- 5 an hour is a fine ceiling for email and a bad one for an alert that
-- repeats until acknowledged: that is a stranger with a web form and the
-- owner's night. So the function reports whether an AOG request ALREADY
-- arrived in the last 10 minutes. The row is stored either way and the inbox
-- shows it either way; only the loud page is suppressed, because the second
-- one is either the same customer resubmitting or someone leaning on it.
-- The route reads this; it never decides from the client's boolean.

alter table public.service_requests
  add column if not exists aog boolean not null default false;

alter table public.service_requests drop constraint if exists service_requests_aog_check;
alter table public.service_requests add constraint service_requests_aog_check
  check (service_line = 'aviation' or not aog);

comment on column public.service_requests.aog is
  'The customer said the aircraft is on the ground. Set from the public form''s AOG checkbox via submit_service_request, which forces it false off aviation. Aviation only (service_requests_aog_check). Shown as an AOG chip in the owner''s Requests inbox and the only request that sends a push. A marker only — it changes no price, and 0065 is where it continues onto a quote. 0071.';

-- The table already revokes everything from anon and PUBLIC (0023); this is
-- the column-level belt as 0065 wrote it, so a later grant on the table
-- cannot quietly expose the new column.
revoke all (aog) on public.service_requests from public;
revoke all (aog) on public.service_requests from anon;

-- ------------------------------------------------------------------ the RPC

-- One overload only (the drift guard at the bottom of 0046 and of this file).
drop function if exists public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text);

create or replace function public.submit_service_request(
  p_name         text,
  p_phone        text default null,
  p_email        text default null,
  p_contact_pref text default null,
  p_vehicle      text default null,
  p_message      text default null,
  p_source       text default 'web',
  p_company      text default null,   -- honeypot: humans never see the field
  p_ip           text default null,
  p_user_agent   text default null,
  p_service_line text default 'automotive',
  p_aog          boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text := left(btrim(coalesce(p_name, '')), 120);
  v_phone   text := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
  v_email   text := nullif(left(btrim(coalesce(p_email, '')), 200), '');
  v_vehicle text := left(btrim(coalesce(p_vehicle, '')), 200);
  v_message text := left(btrim(coalesce(p_message, '')), 4000);
  v_line    text := case when p_service_line = 'aviation' then 'aviation' else 'automotive' end;
  v_aog     boolean;
  v_page    boolean := false;
  v_pref    text;
  v_id      uuid;
begin
  -- The caller's flag is a request, not a fact: an aircraft claim on a car
  -- request is dropped here rather than rejected, so a tampered payload
  -- behaves like an ordinary one.
  v_aog := coalesce(p_aog, false) and v_line = 'aviation';

  -- Bots fill every field; a non-empty honeypot is silently accepted and
  -- dropped, so the bot learns nothing from the response. No id in the
  -- reply = the route sends no notification for it either.
  if coalesce(btrim(p_company), '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please give us your name.');
  end if;
  if v_phone is null and v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Leave a phone number or an email so we can reach you.');
  end if;
  if length(v_vehicle) < 2 then
    return jsonb_build_object('ok', false, 'error',
      case when v_line = 'aviation'
        then 'Tell us which aircraft this is about — type and tail number.'
        else 'Tell us which vehicle this is about.' end);
  end if;
  if length(v_message) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Tell us a little about what''s going on.');
  end if;

  -- A preference is only stored when the channel to honor it was provided.
  v_pref := case
    when p_contact_pref = 'email' and v_email is not null then 'email'
    when p_contact_pref in ('call', 'text') and v_phone is not null then p_contact_pref
    else null
  end;

  -- Abuse brakes, tightest first. p_ip is Vercel-observed, not caller-chosen.
  if p_ip is not null and (
       select count(*) from service_requests
        where ip = p_ip and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many requests — please try again later.');
  end if;
  if p_ip is not null and (
       select count(*) from service_requests
        where ip = p_ip and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many requests — please try again tomorrow.');
  end if;
  if (select count(*) from service_requests
       where created_at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'We''re getting a lot of requests right now — please try again tomorrow.');
  end if;

  -- Page only for the FIRST AOG request in a 10-minute window, counted across
  -- the whole shop rather than per IP: a second phone on the same ramp is the
  -- same aircraft, and an attacker rotating IPs would otherwise page per IP.
  -- Checked before the insert so this row does not suppress itself.
  if v_aog then
    v_page := not exists (
      select 1 from service_requests
       where aog and created_at > now() - interval '10 minutes'
    );
  end if;

  insert into service_requests (name, phone, email, contact_pref, vehicle, message, source, service_line, aog, ip, user_agent)
  values (v_name, v_phone, v_email, v_pref, v_vehicle, v_message,
          case when p_source in ('web', 'qr', 'nfc') then p_source else 'web' end,
          v_line, v_aog,
          p_ip, left(coalesce(p_user_agent, ''), 400))
  returning id into v_id;

  -- 'aog' and 'page' are the function's own decisions, not the caller's.
  return jsonb_build_object('ok', true, 'id', v_id, 'aog', v_aog, 'page', v_page);
end;
$$;

revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text, boolean) from public;
revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text, boolean) from anon;
revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text, boolean) from authenticated;
grant execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text, boolean) to service_role;

comment on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text, boolean) is
  'Public service-request intake. service_role only — called by /api/request, which observes the real IP (0025). p_service_line: ''aviation'' or anything else = ''automotive'' (0046). p_aog is forced false off aviation; the reply''s ''page'' says whether this is the first AOG request in 10 minutes and is the only thing that may wake the owner (0071).';

-- Drift guard, as 0046 wrote it. The shop's only contact channel is this one
-- function; two overloads would make every named call from the route
-- ambiguous and take intake down. Exactly one must remain, or the migration
-- is rolled back — which holds when this file is run as ONE batch (the SQL
-- editor and apply_migration both do; a multi-statement query is one implicit
-- transaction). Do not paste it in pieces.
do $$
declare
  n int;
begin
  select count(*) into n from pg_proc
   where proname = 'submit_service_request' and pronamespace = 'public'::regnamespace;
  if n <> 1 then
    raise exception 'submit_service_request: expected exactly 1 function after 0071, found % — the live signature drifted from the DROP above; rolling back', n;
  end if;
end;
$$;

-- Verify after applying (read-only):
--
--   -- the column, the constraint and the single overload
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_requests' and column_name = 'aog';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.service_requests'::regclass and conname = 'service_requests_aog_check';
--   select count(*) from pg_proc
--    where proname = 'submit_service_request' and pronamespace = 'public'::regnamespace;   -- 1
--
--   -- the constraint REFUSES the row it must refuse (expect an error, then
--   -- roll back; a CHECK that was never made to fail has not been tested)
--   begin;
--     insert into public.service_requests (name, vehicle, message, service_line, aog)
--     values ('constraint test', 'a car', 'should be refused', 'automotive', true);
--   rollback;
--
-- UNDO (the column keeps any rows' values; drop it only if nothing reads it):
--   alter table public.service_requests drop constraint if exists service_requests_aog_check;
--   alter table public.service_requests drop column if exists aog;
--   -- then re-run 0046 to restore the 11-argument function.
