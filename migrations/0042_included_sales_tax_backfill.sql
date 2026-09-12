-- Backfill included_tax_cents on the six invoices that went out with no tax
-- line (see 0041 for the owner's rule and why the documents do not change).
--
-- included tax = round(total_cents × 500 / 10500): the 5% hidden inside a
-- tax-inclusive total. Verified against the live rows on 2026-09-12:
--
--   INV-001  J001   15000  ->   714
--   INV-008  J002   64999  ->  3095
--   INV-009  J004   65500  ->  3119
--   INV-011  J006   46600  ->  2219
--   INV-013  J005   56500  ->  2690
--   INV-015  J010   34000  ->  1619
--                    sum  = 13456
--
-- Skipped by the WHERE clause, on purpose:
--   INV-012  J005   void   — a void revision governs nothing (and no draft
--                            is stamped: only sent/paid invoices are issued).
--   INV-014  J008   tax_cents 3575 on 75075 — tax was charged, nothing included.
--
-- Idempotent: only rows still at 0 are touched, so re-running changes nothing.
-- ISSUED invoices only (sent or paid — Reports' own definition): a draft owes
-- the state nothing yet, and a 0% draft stamped here that later gained a tax
-- rate through invoice-refresh would carry tax_cents AND included_tax_cents,
-- counting the tax twice (0041 deliberately has no CHECK against that).
--
-- NOT covered automatically: an invoice issued untaxed AFTER today. Nothing
-- in the app writes included_tax_cents, so such an invoice understates the
-- state's share until this backfill is re-run by hand (it is safe to re-run)
-- or a snapshot rule is added (set it when a 0-rate invoice is sent, zero it
-- when a rate is set). New documents start at 5% (0041), so this needs the
-- owner to have zeroed the rate on the document on purpose.
--
-- UNDO (books only; no document changes either way):
--   update public.invoices set included_tax_cents = 0
--    where invoice_number in ('INV-001','INV-008','INV-009','INV-011','INV-013','INV-015');

update public.invoices
   set included_tax_cents = round(total_cents * 500.0 / 10500)
 where status in ('sent', 'paid')
   and tax_cents = 0
   and total_cents > 0
   and included_tax_cents = 0;

-- Verify after applying (expect 6 rows summing to 13456):
--   select invoice_number, total_cents, included_tax_cents
--     from public.invoices where included_tax_cents > 0 order by invoice_number;
