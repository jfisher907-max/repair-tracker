-- Close the direct-RPC path into the public intake.
--
-- 0023 granted submit_service_request to anon so the browser could call it —
-- but the anon key is public by design, so anyone could invoke the function
-- directly with curl and CONTROL EVERY ARGUMENT: omit the honeypot, pass a
-- fresh fake p_ip per call (the per-IP cap keys on that argument), and walk
-- straight to the global 200/day cap — which then locks REAL customers out
-- (a self-DoS of the shop's only contact channel).
--
-- Fix: only the server route may call it. The route runs with service_role
-- and observes the real client IP from Vercel's header, so p_ip is no longer
-- attacker-chosen. A per-IP daily tier joins the hourly one (5/hour alone
-- allows 120/day/IP — two IPs could trip the global cap). And the real
-- insert now returns the row id, so the route can notify the owner without
-- honeypot hits triggering notifications (both paths still return ok:true
-- to the caller — bots learn nothing).
--
-- (0024 is reserved: the is_owner() single-owner cut, applied by the owner.)

revoke execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) from anon;
revoke execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) from authenticated;
-- 0023 revoked PUBLIC's default EXECUTE, so service_role holds no implicit
-- privilege — without this explicit grant the route would fail with 42501.
grant execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) to service_role;

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
  p_user_agent   text default null
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
    return jsonb_build_object('ok', false, 'error', 'Tell us which vehicle this is about.');
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

  -- Abuse brakes, tightest first. p_ip is Vercel-observed now, not caller-chosen.
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

  insert into service_requests (name, phone, email, contact_pref, vehicle, message, source, ip, user_agent)
  values (v_name, v_phone, v_email, v_pref, v_vehicle, v_message,
          case when p_source in ('web', 'qr', 'nfc') then p_source else 'web' end,
          p_ip, left(coalesce(p_user_agent, ''), 400))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
