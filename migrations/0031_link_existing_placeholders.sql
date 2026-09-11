-- 0031: link the approved parts already sitting on jobs to their quote lines.
--
-- One-time data change, run only with the owner's OK. It touches exactly the
-- lines convert_quote_to_job wrote before 0030 existed: cost 0, no receipt,
-- a real approved charge, and an exact match (description, qty, charge) to a
-- non-declined line on the quote that created the job. On 2026-09-11 that
-- was 8 rows - J004 x4 (paid, INV-009) and J014 x4 - each matching exactly
-- one quote line. No charge, cost or wording changes; the lines just become
-- "awaiting cost" so a receipt fills them instead of adding beside them.
--
-- Reverse with:
--   update part_lines set quote_line_id = null, awaiting_cost = false
--    where id in (<the ids this updated>);

update public.part_lines pl
   set quote_line_id = ql.id,
       awaiting_cost = true
  from public.quote_lines ql
  join public.quotes q on q.id = ql.quote_id
 where q.job_id = pl.job_id
   and not ql.declined
   and ql.description = pl.description
   and ql.qty = pl.qty
   and ql.unit_charge_cents = pl.unit_charge_cents
   and pl.quote_line_id is null
   and pl.receipt_id is null
   and pl.unit_cost_cents = 0
   and coalesce(pl.unit_charge_cents, 0) > 0
   -- only where the pairing is unambiguous
   and (select count(*) from public.quote_lines ql2
          join public.quotes q2 on q2.id = ql2.quote_id
         where q2.job_id = pl.job_id and not ql2.declined
           and ql2.description = pl.description and ql2.qty = pl.qty
           and ql2.unit_charge_cents = pl.unit_charge_cents) = 1
   -- ...and only while the job's parts cost has NOT already been recorded.
   -- Once a receipt has been saved through fill_receipt, that cost is on the
   -- job (as shop-cost lines, since these placeholders weren't tagged yet).
   -- Tagging them now would put "Enter cost" prompts back on a job whose cost
   -- is already booked, and following them would count the parts twice.
   and not exists (
     select 1 from public.receipts r
      where r.job_id = pl.job_id and r.saved_at is not null
   );

-- Jobs this deliberately skipped, for the hand check: any placeholder still at
-- $0 cost on a job whose receipt is already in.
--   select j.job_number, pl.description, pl.unit_charge_cents
--     from public.part_lines pl
--     join public.jobs j on j.id = pl.job_id
--    where pl.unit_cost_cents = 0 and coalesce(pl.unit_charge_cents,0) > 0
--      and pl.quote_line_id is null and pl.receipt_id is null
--      and exists (select 1 from public.receipts r
--                   where r.job_id = pl.job_id and r.saved_at is not null);
