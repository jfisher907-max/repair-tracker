-- 0054: logged-out visitors hold no table, view, sequence or helper-function access.
-- SEC-2, owner's answer 2026-09-29: "Yes, remove them".
-- Measured 2026-09-29: anon held ALL on 20 of 23 tables + view quote_totals, SELECT/UPDATE/USAGE on
-- 3 sequences, EXECUTE on 12 non-DEFINER functions. RLS refused every row, but TRUNCATE is not
-- subject to row security. No logged-out path touches a table directly:
--   /q/[token] -> rpc get_public_quote, mark_quote_viewed (browser anon)
--   /i/[token] -> rpc get_public_invoice; /s/[token] -> rpc get_public_statement (browser anon)
--   /api/pay/session -> rpc get_public_quote | get_public_invoice (server anon)
--   /api/quote/respond, /api/request, /api/photos, /api/pay/session-state, /api/pay/webhook -> service role
-- The four DEFINER RPCs keep anon EXECUTE. Revoking them would blank every customer link.

revoke all on all tables in schema public from anon;      -- ALL TABLES includes views; no-op on the 5 already clean
revoke all on all sequences in schema public from anon;   -- ALL TABLES does not cover sequences

revoke all on function public.apply_quote_to_job(uuid) from public, anon;
revoke all on function public.refresh_job_payment_cache(uuid) from public, anon;
revoke all on function public.invoice_paid_cents(uuid) from public, anon;
revoke all on function public.quote_deposit_cents(uuid) from public, anon;
revoke all on function public.quote_deposit_outstanding_cents(uuid) from public, anon;
-- trigger functions: safe to revoke. Every role that writes these tables (authenticated,
-- service_role, and postgres inside the DEFINER functions) keeps EXECUTE, granted below.
revoke all on function public.book_included_sales_tax() from public, anon;
revoke all on function public.part_lines_clear_awaiting_cost() from public, anon;
revoke all on function public.quote_lines_frozen_once_applied() from public, anon;
revoke all on function public.set_updated_at() from public, anon;
grant execute on function
  public.apply_quote_to_job(uuid), public.refresh_job_payment_cache(uuid),
  public.invoice_paid_cents(uuid), public.quote_deposit_cents(uuid),
  public.quote_deposit_outstanding_cents(uuid), public.book_included_sales_tax(),
  public.part_lines_clear_awaiting_cost(), public.quote_lines_frozen_once_applied(),
  public.set_updated_at()
  to authenticated, service_role;
-- Left anon-executable on purpose: get_public_invoice, get_public_quote, get_public_statement,
-- mark_quote_viewed (customer links); is_owner, shop_today, snapshot_pre_tax_cents (read no table).

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
-- New functions still get PUBLIC EXECUTE (a global default a per-schema command can't remove).
-- Every function migration keeps the house line: revoke all on function ... from public, anon;
-- Objects created by supabase_admin still default to anon ALL (its own pg_default_acl entry,
-- which postgres cannot alter). Our migrations run as postgres, so the normal path is covered;
-- run check (a) after every future migration anyway.

-- VERIFY after applying:
-- (a) expect 0 rows (MAINTAIN included: it is a PG17 privilege and part of ALL)
-- select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind in ('r','v','m','p','f')
--    and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN');
-- (b) expect 0 rows
-- select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind='S' and has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE');
-- (c) expect exactly: get_public_invoice, get_public_quote, get_public_statement, is_owner,
--     mark_quote_viewed, shop_today, snapshot_pre_tax_cents
-- select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1;
-- (d) owner untouched, expect 0 rows
-- select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind in ('r','v') and not has_table_privilege('authenticated', c.oid, 'SELECT');
-- (e) expect no 'anon=' inside any defaclacl (the supabase_admin rows are expected to keep it)
-- select defaclobjtype, defaclacl::text from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
--  where n.nspname='public' and pg_get_userbyid(d.defaclrole)='postgres';

-- ROLLBACK (restores exactly what was measured 2026-09-29; deliberately NOT re-granting on
-- job_totals, job_authorized_totals, job_authorizations, tips, tax_filings, which had no anon grant):
-- grant all on table
--   public.business_documents, public.customers, public.expenses, public.hangar_sessions,
--   public.hangar_unavailability, public.invoices, public.job_photos, public.job_templates,
--   public.jobs, public.part_lines, public.payments, public.quote_approvals, public.quote_lines,
--   public.quotes, public.receipts, public.recommendations, public.service_requests,
--   public.settings, public.vehicle_reminders, public.vehicles, public.quote_totals
--   to anon;
-- grant select, update, usage on sequence public.invoice_number_seq, public.job_number_seq, public.quote_number_seq to anon;
-- grant execute on function
--   public.apply_quote_to_job(uuid), public.refresh_job_payment_cache(uuid),
--   public.invoice_paid_cents(uuid), public.quote_deposit_cents(uuid),
--   public.quote_deposit_outstanding_cents(uuid), public.book_included_sales_tax(),
--   public.part_lines_clear_awaiting_cost(), public.quote_lines_frozen_once_applied(),
--   public.set_updated_at()
--   to public, anon;
-- alter default privileges for role postgres in schema public grant all on tables to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;
-- alter default privileges for role postgres in schema public grant all on functions to anon;
