-- Sales tax that was never charged is still owed — it comes out of the total.
--
-- The owner's rule (2026-09-12): "Everything should default to having sales
-- tax applied. That means I need to take 5% out of my profit somewhere on the
-- invoices that didn't have a sales tax line applied." Juneau sales tax is 5%.
--
-- Six live paid invoices went out with tax_rate_bp 0 and no tax line. The
-- customer paid exactly what the paper said, and that paper does not change:
-- the customer-facing documents (DocView, /i, /q, /s, /report) never read the
-- column added here. What changes is the SHOP'S books. The money those
-- customers paid already contains the state's 5%, so on each of those
-- invoices:
--
--   included tax = round(total × 5 / 105)   (500 bp on a tax-inclusive total)
--
-- is not the shop's revenue and not its profit. It is recorded on the invoice
-- as included_tax_cents, and only there — total_cents, labor_cents,
-- parts_cents, tax_cents and tax_rate_bp are untouched, so every snapshot,
-- statement and public link renders exactly as issued. The backfill for the
-- six invoices is migration 0042; this file only adds the column, hardens the
-- default and teaches job_totals about it.
--
-- Two rules keep the column honest:
--   * it is only ever set on an invoice whose tax_cents is 0 — an invoice that
--     charged tax has nothing "included". The backfill's WHERE enforces that;
--     it is deliberately NOT a CHECK, so a draft that later gains a tax rate
--     through invoice-refresh cannot be rejected by a books-only column.
--   * the settings default becomes 500 bp so no new invoice or quote starts
--     untaxed by accident. Drafts keep the rate they were made with (that is a
--     choice the owner made on the document), so invoice-refresh is untouched.

alter table public.invoices
  add column if not exists included_tax_cents integer not null default 0
    check (included_tax_cents >= 0);

comment on column public.invoices.included_tax_cents is
  'Sales tax included in total_cents because no tax line was charged (tax_cents = 0); owed to the state out of the total. Never shown to the customer: the document is exactly what they paid. Set by migration 0042 for the six pre-rule invoices.';

-- ---------------------------------------------------------------------------
-- Default hardening: every new document starts at 5% unless the owner changes
-- it on the document itself.
-- ---------------------------------------------------------------------------

alter table public.settings
  alter column default_tax_rate_bp set default 500;

update public.settings
  set default_tax_rate_bp = 500
  where default_tax_rate_bp = 0;

-- ---------------------------------------------------------------------------
-- job_totals: profit now takes out the sales tax hidden inside an untaxed
-- invoice's total. total_charged_cents stays what the customer pays.
--
-- The governing invoice of a job is its largest-total non-void invoice — the
-- revision rule used everywhere else (finances.ts, the job page). Ties break
-- on the newest. It is fetched with a scalar subquery, NOT a join: jobs
-- already joins part_lines here and a second one-to-many join would multiply
-- both sums (the same warning as 0027).
--
-- lib/calc.ts computeTotals mirrors this view — keep the two identical.
-- ---------------------------------------------------------------------------

create or replace view public.job_totals as
  select
    j.id as job_id,
    round(j.labor_hours * j.labor_rate_cents::numeric)::integer as labor_charge_cents,
    (coalesce(sum(pl.line_total_cents), 0::bigint)
      + coalesce((select sum(r.tax_cents) from public.receipts r where r.job_id = j.id), 0::bigint)
    )::integer as parts_cost_cents,
    coalesce(
      j.parts_charged_override_cents::bigint,
      coalesce(sum(pl.line_charge_total_cents), 0::bigint)
    )::integer as parts_charged_cents,
    (round(j.labor_hours * j.labor_rate_cents::numeric)
      + coalesce(
          j.parts_charged_override_cents::bigint,
          coalesce(sum(pl.line_charge_total_cents), 0::bigint)
        )::numeric
    )::integer as total_charged_cents,
    (round(j.labor_hours * j.labor_rate_cents::numeric)
      + coalesce(
          j.parts_charged_override_cents::bigint,
          coalesce(sum(pl.line_charge_total_cents), 0::bigint)
        )::numeric
      - coalesce(sum(pl.line_total_cents), 0::bigint)::numeric
      - coalesce((select sum(r.tax_cents) from public.receipts r where r.job_id = j.id), 0::numeric)
      - coalesce(
          (select i.included_tax_cents
             from public.invoices i
            where i.job_id = j.id and i.status <> 'void'
            order by i.total_cents desc, i.created_at desc
            limit 1),
          0
        )::numeric
    )::integer as profit_cents,
    -- LAST on purpose. CREATE OR REPLACE VIEW may only APPEND columns: the live
    -- view ends at profit_cents, and putting this before it fails with
    -- "cannot change name of view column" after the column add and the
    -- settings change above have already run. Do not DROP VIEW instead —
    -- job_authorized_totals, get_public_statement, refresh_job_payment_cache
    -- and quote_deposit_outstanding_cents all depend on job_totals.
    coalesce(
      (select i.included_tax_cents
         from public.invoices i
        where i.job_id = j.id and i.status <> 'void'
        order by i.total_cents desc, i.created_at desc
        limit 1),
      0
    )::integer as included_tax_cents
  from public.jobs j
  left join public.part_lines pl on pl.job_id = j.id
  group by j.id;

comment on view public.job_totals is
  'Per-job money. profit_cents = labor + parts charged − parts cost (counter tax included) − sales tax included in the governing invoice''s total (0041). total_charged_cents is what the customer pays and never changes here.';
