-- Relax the tax_cents CHECK added hours earlier in 0027, before it has ever
-- constrained real data (every row is still 0).
--
-- 0027 wrote `check (tax_cents >= 0)`, which contradicts the app around it:
-- returns are a first-class flow (the extractor reads refunds as negative
-- unit_cost, markedUpCharge refuses to mark up a credit, and the scan screen
-- says in as many words that negative amounts are fine for returns). A Juneau
-- return refunds the 5% too, so a credit slip carries NEGATIVE tax. Under the
-- old constraint that was unrecordable, and typing it raised a raw Postgres
-- constraint violation in an alert() — the job then keeps that tax as cost
-- forever, which is the exact error 0027 exists to prevent, with the sign
-- flipped.
--
-- No row changes value: this only widens what may be stored.

alter table public.receipts drop constraint if exists receipts_tax_cents_check;

alter table public.receipts
  add constraint receipts_tax_cents_check
  check (tax_cents is not null);

comment on column public.receipts.tax_cents is
  'Sales tax printed on this purchase receipt — negative on a credit/return slip. A cost of the job, never a customer charge: excluded from every invoice/quote snapshot, never marked up, never re-taxed.';
