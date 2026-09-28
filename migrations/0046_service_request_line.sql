-- Which side of the shop a service request is for: automotive or aviation.
--
-- The owner's ask: "can we have an aviation tab and an automotive tab?" The
-- public page now tailors itself to one of the two lines (tabs in "What we
-- do", a matching toggle at the top of the request form), and the request
-- records which one the customer was on, so the inbox can tell a car from an
-- aircraft at a glance.
--
-- Column: NOT NULL with a constant default, so every existing row reads
-- 'automotive' (the only line the form offered until now) and the add is a
-- metadata-only change. The CHECK is named so it can be found and replaced;
-- NOT NULL rules out the CHECK-passes-on-NULL gap.
--
-- Function: the intake stays route-only (0025). submit_service_request gains
-- p_service_line, validated here too — anything other than 'aviation' is
-- 'automotive', matching the route. The old 10-argument signature is DROPPED
-- rather than overloaded: an 11-argument version with a defaulted last
-- parameter beside it would make every 10-argument named call ambiguous
-- ("function is not unique"). Grants are re-stated for the new signature —
-- service_role only, and PUBLIC/anon/authenticated explicitly revoked,
-- because Supabase's default privileges grant EXECUTE on a newly created
-- public function to anon and authenticated directly, not only via PUBLIC.
--
-- Deploy order: the route (app/api/request/route.ts) sends p_service_line and,
-- if PostgREST reports the 11-argument function missing (PGRST202 — this file
-- not yet applied), retries once without it, so the site keeps taking
-- requests whichever lands first. RLS is unchanged: owner_all (0023) already
-- covers every column. (anon does hold table grants on service_requests —
-- Supabase's defaults — but no policy admits anon, so RLS refuses every
-- anon read and write; verified 2026-09-27.)

alter table public.service_requests
  add column if not exists service_line text not null default 'automotive';

alter table public.service_requests
  drop constraint if exists service_requests_service_line_check;
alter table public.service_requests
  add constraint service_requests_service_line_check
    check (service_line in ('automotive', 'aviation'));

comment on column public.service_requests.service_line is
  'Which side of the shop the request is for: automotive (default; every row before 0046) or aviation. Set from the public page''s Automotive / Aviation choice via submit_service_request; shown as an "Aviation" chip in the owner''s Requests inbox.';

-- The live signature, read from pg_proc on 2026-09-27 before this file was
-- finalised (one row):
--   submit_service_request(text,text,text,text,text,text,text,text,text,text)
--   p_name text, p_phone text, p_email text, p_contact_pref text,
--   p_vehicle text, p_message text, p_source text, p_company text,
--   p_ip text, p_user_agent text
-- This DROP names exactly that. If the live function has drifted, the DROP
-- finds nothing, the CREATE below adds a second overload, and the check at
-- the end of this file raises — rolling the whole migration back rather
-- than leaving two versions that make every named call ambiguous.
drop function if exists public.submit_service_request(text, text, text, text, text, text, text, text, text, text);

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
  p_service_line text default 'automotive'
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
  v_pref    text;
  v_id      uuid;
begin
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

  insert into service_requests (name, phone, email, contact_pref, vehicle, message, source, service_line, ip, user_agent)
  values (v_name, v_phone, v_email, v_pref, v_vehicle, v_message,
          case when p_source in ('web', 'qr', 'nfc') then p_source else 'web' end,
          v_line,
          p_ip, left(coalesce(p_user_agent, ''), 400))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text) to service_role;

comment on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text, text) is
  'Public service-request intake. service_role only — called by /api/request, which observes the real IP (0025). p_service_line: ''aviation'' or anything else = ''automotive'' (0046).';

-- Drift guard. The shop's only contact channel is this one function; two
-- overloads would make every named call from the route ambiguous and take
-- intake down. Exactly one must remain, or the migration is rolled back —
-- which holds when this file is run as ONE batch (the SQL editor and
-- apply_migration both do; a multi-statement query is one implicit
-- transaction). Do not paste it in pieces.
do $$
declare
  n int;
begin
  select count(*) into n from pg_proc
   where proname = 'submit_service_request' and pronamespace = 'public'::regnamespace;
  if n <> 1 then
    raise exception 'submit_service_request: expected exactly 1 function after 0046, found % — the live signature drifted from the DROP above; rolling back', n;
  end if;
end;
$$;
