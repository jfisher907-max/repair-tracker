-- 0040: remember what a core deposit WAS, so its cost can go to zero.
--
-- Owner's rule (2026-09-11): "The core charge should be shown as 0 unless the
-- core gets denied." A core is a wash - money out, money back - so once the
-- store credits it, the deposit must stop counting as a cost on the job.
--
-- But the worklist still has to show "$30 out", the tally still has to say
-- "$45 credited back", and Undo has to be able to put the cost back. So the
-- deposit amount is kept here and unit_cost_cents becomes the LIVE cost:
--
--   out / awaiting credit : unit_cost = deposit   (the money really is out)
--   credited              : unit_cost = 0         (it came back)
--   denied, absorbed      : unit_cost = deposit   (the shop ate it)
--   denied, billed        : unit_cost = deposit, charge = deposit (at cost)
--
-- The backfill only RECORDS the amount; it changes no money. In particular it
-- deliberately does not zero J002's two credited cores: that job already
-- carries a hand-entered -$90.00 "Core Charge Return" line, and zeroing the
-- deposits on top of it would credit the same refund twice and inflate the
-- job's profit by $90.

alter table public.part_lines
  add column if not exists core_deposit_cents integer;

comment on column public.part_lines.core_deposit_cents is
  'For a core deposit line: the original deposit. unit_cost_cents is the LIVE cost and goes to 0 once the supplier credits it back.';

update public.part_lines
   set core_deposit_cents = unit_cost_cents
 where core_deposit_cents is null
   and unit_cost_cents > 0
   and description ~* '\ycore\s*(charge|chg|deposit)\y'
   and description !~* '\y(return|refund|credit)\y';
