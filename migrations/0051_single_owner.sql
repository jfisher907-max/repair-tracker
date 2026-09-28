-- 0051: one owner. The long-planned "single-owner cut" (reserved as 0024 in
-- 0025's notes, never applied).
--
-- is_owner() gates every table policy and the private receipts bucket. On
-- 2026-08-18 it was widened by hand (in no migration) to a two-email allowlist
-- so a browser-testing account, claude-tester@wingsnthings.repair, could sign
-- in with full owner power. That account's password later turned up in
-- plaintext on local disk; it had no MFA and 13 live sessions. Security review
-- 2026-09-27; the owner approved removing it.
--
-- ORDER MATTERS, and both happen in this one transaction: is_owner() stops
-- accepting the tester's email FIRST, so any JWT it still holds (they outlive a
-- user deletion by up to an hour) is refused everywhere at once; then the user
-- row goes, which cascades its sessions, refresh tokens and identities.
--
-- The function keeps exactly its live shape (SQL, STABLE, security invoker,
-- no search_path) — only the allowlist shrinks to the owner.

create or replace function public.is_owner()
returns boolean
language sql
stable
as $function$
  select coalesce((auth.jwt() ->> 'email'), '') = 'jfisher907@gmail.com'
$function$;

delete from auth.users where email = 'claude-tester@wingsnthings.repair';

-- Verify (expect the single-email body; 0 tester users; 0 tester sessions):
--   select pg_get_functiondef('public.is_owner()'::regprocedure);
--   select count(*) from auth.users where email = 'claude-tester@wingsnthings.repair';
