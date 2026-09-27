-- 0049: a customer statement lists finished work only, at what the customer
-- is actually billed.
--
-- The owner (2026-09-27): "scheduled jobs stay off the statements entirely
-- until the work is done and money is collected." As read back to him: a
-- statement lists FINISHED (stage done) work only; scheduled and in-progress
-- jobs stay off it, deposits or not.
--
-- Live before this migration (read 2026-09-27): the statement listed every
-- job not marked paid, whatever its stage. J003 ($1,860.86, scheduled) and
-- J016 ($840.00, scheduled) were on their customers' statements as balances
-- owed for work that has not been started. The customer page already kept
-- them out of "owes" (0043), so the page and the link it sends disagreed.
--
-- Two changes to get_public_statement, and ONLY these two. The body below is
-- 0035's, verified identical to the live function before it was copied
-- (md5(prosrc) = ddfd739a5434542a3e8eb84cfe3d9216, 1912 bytes, on
-- 2026-09-27); SECURITY DEFINER, STABLE, search_path, the returned fields and
-- the grants (none are restated: CREATE OR REPLACE keeps the existing ACL —
-- postgres, anon, authenticated, service_role EXECUTE) are unchanged.
--
-- 1. Finished work only: coalesce(j.stage, 'done') = 'done'. jobs.stage is
--    NOT NULL DEFAULT 'done' (0043), so the coalesce never fires today; it
--    states the same default 0043 chose (a row with no stage is pre-0043
--    finished work) so the statement cannot drift from the column's meaning.
--
-- 2. total_cents: a case on whether the job has a live invoice.
--      * a live invoice -> UNCHANGED from 0035: greatest(capped charge, the
--        largest live invoice's total). That largest total is the governing
--        invoice's (lib/calc governingInvoice). Keeping greatest() is
--        deliberate: it is the target refresh_job_payment_cache sets the
--        job's paid status against and the figure owedGrossCents gives the
--        job page, Reports' receivables and the dashboard's oldest-owed. A
--        job that grew after its (draft) invoice therefore shows the same
--        balance on the statement as on every owner surface, and the job
--        page's stale-invoice note tells the owner to update the invoice.
--      * finished, no invoice yet -> the capped before-tax figure (0035's cap:
--        the approved total, only when there is a real approved estimate)
--        PLUS the sales tax the invoice will carry, computed exactly as
--        lib/billing.ts buildInvoiceSnapshot computes invoice tax:
--        round(pre-tax × rate_bp / 10000), at settings.default_tax_rate_bp,
--        or 500 (Juneau's 5%) only when Settings has no row — the same rate
--        Create invoice bills (jobs/[id] createInvoice, lib/calc
--        billedTaxRateBp). Settings at 0% means the invoice carries no tax
--        line, so the statement adds none either; the tax the shop then owes
--        the city out of its own money is the books' business (0047 books it
--        at 5%), never the customer's. Before this the statement showed such
--        a job BEFORE tax while its invoice, once made, would bill 5% more:
--        the statement understated what the customer would be billed.
--        Numeric arithmetic: pre-tax × 500 overflows integer above $42,949.67.
--        round() on numeric rounds half away from zero; JS Math.round rounds
--        half up; for the non-negative amounts here the two agree.
--
-- Not changed, on purpose (brief: nothing else): invoice_number and due_date
-- still come from the NEWEST live invoice (created_at desc). With revisions
-- that is almost always the governing one; when a newer, smaller live
-- revision exists they can name a different invoice than the total. Paid is
-- still every payment on the job — tips (0048) are not payments and never
-- count here.

create or replace function public.get_public_statement(token uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'customer_name', c.name,
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email,
        'payment_instructions', s.invoice_payment_instructions
      ) from public.settings s limit 1
    ),
    'items', (
      select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb) from (
        select jsonb_build_object(
          'job_number', j.job_number,
          'title', j.title,
          'date', j.date,
          'invoice_number', (
            select i.invoice_number from public.invoices i
            where i.job_id = j.id and i.status <> 'void'
            order by i.created_at desc limit 1
          ),
          'due_date', (
            select i.due_date from public.invoices i
            where i.job_id = j.id and i.status <> 'void'
            order by i.created_at desc limit 1
          ),
          'total_cents', case
            when exists (select 1 from public.invoices i
                         where i.job_id = j.id and i.status <> 'void')
            then greatest(
              case when a.checked and a.quoted_cents > 0
                   then least(t.total_charged_cents, a.authorized_cents)
                   else t.total_charged_cents end,
              (select max(i.total_cents) from public.invoices i
                where i.job_id = j.id and i.status <> 'void')
            )
            else (case when a.checked and a.quoted_cents > 0
                       then least(t.total_charged_cents, a.authorized_cents)
                       else t.total_charged_cents end)
                 + round(
                     (case when a.checked and a.quoted_cents > 0
                           then least(t.total_charged_cents, a.authorized_cents)
                           else t.total_charged_cents end)::numeric
                     * coalesce((select s.default_tax_rate_bp
                                   from public.settings s limit 1), 500)
                     / 10000
                   )::integer
          end,
          'paid_cents', coalesce(
            (select sum(p.amount_cents) from public.payments p where p.job_id = j.id),
            j.amount_paid_cents, 0
          )
        ) as item
        from public.jobs j
        join public.vehicles v on v.id = j.vehicle_id
        join public.job_totals t on t.job_id = j.id
        join public.job_authorized_totals a on a.job_id = j.id
        where v.customer_id = c.id and j.deleted_at is null and j.payment_status <> 'paid'
          and coalesce(j.stage, 'done') = 'done'
      ) sub
    )
  )
  from public.customers c
  where c.public_token = token and c.deleted_at is null
$function$;

-- Verify after applying (read-only):
--
--   -- the two changes are in, the rest is not touched:
--   select position('coalesce(j.stage, ''done'') = ''done''' in prosrc) > 0 as finished_only,
--          position('/ 10000' in prosrc) > 0 as taxes_uninvoiced,
--          prosecdef, provolatile, proconfig
--     from pg_proc where oid = 'public.get_public_statement(uuid)'::regprocedure;
--     -> true, true, true, s, {search_path=public}
--   select proacl from pg_proc where oid = 'public.get_public_statement(uuid)'::regprocedure;
--     -> unchanged: postgres, anon, authenticated, service_role EXECUTE
--
--   -- no scheduled or in-progress job on any statement:
--   select c.name, item->>'job_number' as job
--     from public.customers c
--     cross join lateral jsonb_array_elements(public.get_public_statement(c.public_token)->'items') item
--     join public.jobs j on j.job_number = item->>'job_number'
--    where c.deleted_at is null and j.stage <> 'done';
--     -> no rows (J003 and J016 are gone from their statements)
--
-- UNDO: re-run migrations/0035_statement_cap_needs_approval.sql (it is the
-- previous body in full).
