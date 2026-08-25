-- Sales tax paid at the parts counter is a COST, not a charge.
--
-- The receipt review screen reconciles the lines you type against the printed
-- receipt total, and the tax on the paper made that impossible to satisfy
-- honestly. Both available workarounds were wrong:
--
--   Add "Sales tax" as a part line — it reconciles, but the line is then a
--   customer-facing charge. isPassThrough() correctly declines to mark it up,
--   so it bills at cost; but it still prints on the invoice as a line item AND
--   the invoice's own tax_rate_bp is applied to a subtotal that now contains
--   it. The customer pays tax on tax.
--
--   Leave it off — the invoice is clean, but the shop's recorded cost is short
--   by the tax actually paid, so job profit and the P&L both read high.
--
-- The tax belongs to the RECEIPT, not to any line: it is money that left the
-- business, attributable to the job, that the customer must never be shown and
-- must never be marked up or re-taxed. Recording it here reconciles the paper
-- (lines + tax = printed total), corrects cost and profit, and cannot reach a
-- customer document because no customer-facing code path reads it.
--
-- Existing receipts default to 0, so nothing already recorded changes value.

alter table public.receipts
  add column if not exists tax_cents integer not null default 0
    check (tax_cents >= 0);

comment on column public.receipts.tax_cents is
  'Sales tax printed on this purchase receipt. A cost of the job, never a customer charge: excluded from every invoice/quote snapshot, never marked up, never re-taxed.';

-- ---------------------------------------------------------------------------
-- job_totals: parts cost (and therefore profit) now carry the purchase tax.
--
-- The tax is fetched with a scalar subquery, NOT a join — jobs already joins
-- part_lines here, and a second one-to-many join would multiply both sums.
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
    )::integer as profit_cents
  from public.jobs j
  left join public.part_lines pl on pl.job_id = j.id
  group by j.id;
