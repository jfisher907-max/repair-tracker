-- 0068: phone push notifications for new service requests.
--
-- Owner, 2026-11-04: "I need a better way to get notified if a customer leaves
-- a request." The dashboard banner only shows when the app is open and the
-- email alert is easy to miss, so the installed app now gets a lock-screen
-- push the moment /api/request stores a real request.
--
-- One row per device the owner turned alerts on for. The browser (signed in,
-- RLS) writes and removes its own row from Settings; /api/request reads every
-- row with the service role to send, and deletes rows the push service
-- reports as gone (404/410: app uninstalled, permission revoked).
--
-- endpoint/p256dh/auth are the browser's PushSubscription. They are not
-- passwords, but anyone holding them plus the server's VAPID private key can
-- push to the device, so the table is owner-only like everything else.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  -- Lets Settings label the device ("iPhone", "Chrome on Mac").
  user_agent   text,
  created_at   timestamptz not null default now(),
  -- Last time a push to this device was accepted by its push service.
  last_sent_at timestamptz
);

alter table public.push_subscriptions enable row level security;

drop policy if exists owner_all on public.push_subscriptions;
create policy owner_all on public.push_subscriptions
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- House rule since 0054: logged-out visitors hold nothing.
revoke all on table public.push_subscriptions from anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated, service_role;

-- Verify (expect rls on, one owner_all policy, no anon grants):
--   select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass;
--   select polname from pg_policy where polrelid = 'public.push_subscriptions'::regclass;
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'push_subscriptions' and grantee = 'anon';
