-- 0050: job_totals is readable by the owner only.
--
-- Security review 2026-09-27 (task_d345bd4e): job_totals is a view owned by
-- postgres with no security_invoker, and anon held SELECT on it. A view runs
-- with its OWNER's rights unless security_invoker is set, so RLS on the base
-- tables never applied: anyone with the public (publishable) key could GET
-- /rest/v1/job_totals and read every job's charged, parts cost, profit and
-- included tax — no names, but the shop's whole margin. Measured: 15 rows.
--
-- Fix, both halves:
--   1. revoke every privilege anon held on the view (SELECT was the live one;
--      the DML grants could not be used — the view is not updatable);
--   2. security_invoker = true, so the view reads its base tables with the
--      CALLER's rights and RLS (is_owner()) applies to anyone who reads it.
--
-- Who still reads it, traced before applying:
--   * the owner's app (lib/data.ts, lib/payments.ts) as the signed-in owner —
--     authenticated keeps its grant and passes is_owner() on every base table;
--   * get_public_statement — SECURITY DEFINER, owned by postgres, and no base
--     table has FORCE ROW LEVEL SECURITY, so it reads as before;
--   * refresh_job_payment_cache / quote_deposit_outstanding_cents — invoker
--     functions, but only ever called from DEFINER functions or by the owner;
--     nothing in the app calls them as anon.
--
-- DO NOT recreate this view with CREATE OR REPLACE VIEW without restating
-- WITH (security_invoker = true) — replacing the view is exactly how this gap
-- would reopen. Re-check with the query at the bottom after any such change.

revoke all on public.job_totals from anon;
alter view public.job_totals set (security_invoker = true);

-- Verify (expect: security_invoker=true in reloptions; anon has no privilege):
--   select reloptions from pg_class where oid = 'public.job_totals'::regclass;
--   select has_table_privilege('anon', 'public.job_totals', 'select');
