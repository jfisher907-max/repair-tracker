-- The tax on the six untaxed invoices is 5% OF the price, not 5/105 of it.
--
-- 0041/0042 recorded the sales tax owed on the six invoices that went out
-- with no tax line as a slice BACKED OUT of what the customer paid:
-- round(total × 500 / 10500). The City and Borough of Juneau does not allow
-- that. Sales Tax Procedure 130, verbatim:
--
--   "A seller cannot invoice the customer for a selling price of $1,000.00
--    with no notation of the sales tax and then expect to “back-out” the tax
--    when remitting to CBJ.  The sales tax remitted on the CBJ sales tax
--    return must be calculated on the invoiced selling price."
--
-- and, on a seller who received only the invoiced price:
--
--   "At this point, the Seller may not “back out” the tax from the $1,000.00
--    and report only $952.38 ($1,000.00/1.05) as his gross sale.  The tax
--    must be remitted on the full $1,000.00 stated on the invoice."
--
-- So on each of these invoices the FULL invoiced price is the gross sale, the
-- tax owed is 5% ON TOP of it, and because the customer paid only the price,
-- the shop absorbs that 5% out of its own money. included_tax_cents keeps its
-- job (the tax the shop owes on an invoice with no tax line); only its value
-- changes:
--
--   included tax = round(total_cents × 0.05)      (was round(total × 500/10500))
--
--   INV-001  J001   15000    714 ->   750
--   INV-008  J002   64999   3095 ->  3250
--   INV-009  J004   65500   3119 ->  3275
--   INV-011  J006   46600   2219 ->  2330
--   INV-013  J005   56500   2690 ->  2825
--   INV-015  J010   34000   1619 ->  1700
--                    sum   13456 -> 14130      (+674, $6.74)
--
-- What this changes, and what it does not:
--   * total_cents, tax_cents, tax_rate_bp, labor_cents, parts_cents and every
--     snapshot are untouched. No customer document, public link, statement or
--     printed history reads included_tax_cents, so nothing a customer sees
--     moves by a cent.
--   * The shop's books move by $6.74 in total: job_totals.profit_cents on the
--     six jobs, and in lib/finances.ts earned / charged (down $6.74) and
--     taxCollected / taxBilled (up $6.74). cashProfit moves with taxCollected.
--     The identities in finances.ts hold for ANY value of this column —
--     charged and earned subtract the same figure the tax proration adds back
--     — so net := total − included stays true by definition; only the amounts
--     move.
--   * invoices.updated_at is bumped on the six rows by the invoices_updated_at
--     trigger. That is the only side effect.
--
-- GUARD: the update runs only if the rows it would touch are EXACTLY the six
-- invoices above. Anything else — a seventh untaxed invoice, one of the six
-- voided, a row already moved — aborts the whole block with nothing written.
-- Re-running is safe: a second run finds the same six (now at their new
-- values), the guard still matches, and it writes the same numbers again.
--
-- DO NOT re-run 0042 for a new untaxed invoice: its formula is the back-out
-- this migration replaces. (Comment updated with 0047; the SQL below is as
-- applied.) Nothing needs setting by hand any more: from 0047 on, the
-- invoices_book_included_tax trigger writes round(total_cents × rate / 10000)
-- on every untaxed, non-exempt invoice (and the shortfall on a tax line
-- below the rate) while it is a draft and as it leaves draft, and never
-- touches it again once sent or paid.
--
-- UNDO (books only; no document changes either way):
--   update public.invoices set included_tax_cents = round(total_cents * 500.0 / 10500)
--    where invoice_number in ('INV-001','INV-008','INV-009','INV-011','INV-013','INV-015');

do $$
declare
  expected text[] := array['INV-001','INV-008','INV-009','INV-011','INV-013','INV-015'];
  found text[];
  new_sum bigint;
begin
  select coalesce(array_agg(invoice_number order by invoice_number), '{}')
    into found
    from public.invoices
   where tax_cents = 0
     and included_tax_cents > 0
     and status <> 'void';

  if found is distinct from expected then
    raise exception
      '0045 refused: expected the untaxed invoices to be exactly %, found %. Nothing was changed.',
      expected, found;
  end if;

  update public.invoices
     set included_tax_cents = round(total_cents * 0.05)
   where tax_cents = 0
     and included_tax_cents > 0
     and status <> 'void'
     and invoice_number = any (expected);

  select sum(included_tax_cents)
    into new_sum
    from public.invoices
   where invoice_number = any (expected);

  if new_sum is distinct from 14130 then
    raise exception '0045 refused: the six invoices would carry % cents of tax, expected 14130. Rolled back.', new_sum;
  end if;
end
$$;

comment on column public.invoices.included_tax_cents is
  'Sales tax the shop owes on an invoice that went out with no tax line (tax_cents = 0): 5% of the invoiced price, which is the full gross sale (CBJ Procedure 130: tax may not be backed out of a price that billed none). The customer paid the price only, so the shop pays this out of its own money. Never shown to the customer: the document is exactly what they paid. 0 when a tax line was charged. Set by 0042, corrected to 5% of the price by 0045.';

comment on view public.job_totals is
  'Per-job money. total_charged_cents = labor + parts charged, BEFORE any sales tax line: it is not what the customer pays — the customer''s bill is the governing invoice''s total_cents (largest live invoice, ties to newest), which adds the tax line. profit_cents = total_charged − parts cost (counter tax included) − the sales tax the shop owes on a governing invoice that went out with no tax line (included_tax_cents, 0041/0045).';

-- Verify after applying (expect 6 rows summing to 14130, each = round(total × 0.05)):
--   select invoice_number, total_cents, included_tax_cents,
--          included_tax_cents = round(total_cents * 0.05) as ok
--     from public.invoices where included_tax_cents > 0 order by invoice_number;
--   select obj_description('public.job_totals'::regclass, 'pg_class');
