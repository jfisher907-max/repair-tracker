-- Public service requests — the front door for customers.
--
-- The public site deliberately shows no phone number (the owner's number is
-- personal), so this form is the only way in: contact info, the vehicle, and
-- what's wrong. Rows land in an owner-only inbox; nothing on the public side
-- can read anything back.
--
-- Submission follows the established public-write pattern (respond_public_quote):
-- a SECURITY DEFINER function granted to anon, with every input validated and
-- capped in the database, called through a server route that observes the real
-- IP and user agent rather than trusting the browser to report them.

create table if not exists public.service_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  email        text,
  contact_pref text check (contact_pref in ('call', 'text', 'email')),
  vehicle      text not null,
  message      text not null,
  -- new -> contacted -> closed; owner-driven, no automation.
  status       text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  -- Where the request came from: web now; 'qr' / 'nfc' later carry through
  -- a ?src= on the public page.
  source       text not null default 'web',
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.service_requests enable row level security;

drop policy if exists owner_all on public.service_requests;
create policy owner_all on public.service_requests
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- No anon table grants of any kind. The ONLY public path in is the function
-- below; there is no public path out.

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
begin
  -- Bots fill every field; a non-empty honeypot is silently accepted and
  -- dropped, so the bot learns nothing from the response.
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

  -- Abuse brakes: per-caller and global. Inserts are cheap, but an unbounded
  -- public INSERT is how a table becomes a spam bucket overnight.
  if p_ip is not null and (
       select count(*) from service_requests
        where ip = p_ip and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many requests — please try again later.');
  end if;
  if (select count(*) from service_requests
       where created_at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'We''re getting a lot of requests right now — please try again tomorrow.');
  end if;

  insert into service_requests (name, phone, email, contact_pref, vehicle, message, source, ip, user_agent)
  values (v_name, v_phone, v_email,
          case when p_contact_pref in ('call', 'text', 'email') then p_contact_pref else null end,
          v_vehicle, v_message,
          case when p_source in ('web', 'qr', 'nfc') then p_source else 'web' end,
          p_ip, left(coalesce(p_user_agent, ''), 400));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) to anon;
grant execute on function public.submit_service_request(text, text, text, text, text, text, text, text, text, text) to authenticated;
