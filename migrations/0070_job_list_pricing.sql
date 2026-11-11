-- Jobs get the quote screen's pricing rule.
--
-- THE GAP. lib/quote-pricing.ts prices a quote line five ways (match O'Reilly
-- walk-in, markup matrix, cost + %, at cost, manual) and, for the walk-in rule,
-- LEARNS the walk-in/cost ratio per O'Reilly line code from every price Jake
-- has looked up, so after a few parts it proposes the figure itself. A job's
-- part lines had none of it: a blank charge box fell through to
-- markedUpCharge() — the markup matrix alone, and only when Settings has
-- matrix pricing switched on. Parts added straight to a job (a parts run, a
-- part the customer OK'd at the counter) were therefore priced by a different
-- rule than the same part on a quote, and nothing Jake looked up while working
-- a job taught the estimate anything.
--
-- 1. THE FOUR COLUMNS quote_lines already has.
--    unit_list_cents  - O'Reilly's list price (Pro screen), if captured.
--    unit_retail_cents- the WALK-IN price Jake checked. This is the one that
--                       teaches; the rest of the system calls it retail.
--    line_code        - O'Reilly's product line, because pricing follows the
--                       product line. Derived from the part number when blank.
--    price_basis      - how the price was set, so a later reader can tell a
--                       rule-priced line from one Jake typed.
--    All nullable with no default: every existing row keeps exactly the price
--    it already carries, and a null basis reads as "set before this existed".
--
--    NOT touched: unit_charge_cents stays the single source of what the
--    customer pays, and the generated line_charge_total_cents keeps deriving
--    from it. These four are inputs to a SUGGESTION, never a second price.
--    Nothing here re-prices an approved line - migration 0030's rule stands,
--    and the job form still keeps an approved price on edit.
--
-- 2. ONE SAMPLE POOL. The estimate was reading quote_lines only. Now that a
--    job line can record a walk-in price too, a price checked while working a
--    job must teach the quote screen and vice versa, or the app would hold two
--    different opinions about the same part's walk-in ratio depending on which
--    screen asked. The view is the pool, defined once, the way job money math
--    is defined once in job_totals.
--
--    security_invoker = true so the owner's RLS applies THROUGH the view: it
--    reads exactly what the caller could already read, and does not become a
--    way around the policies on either table.

alter table public.part_lines add column if not exists unit_list_cents integer;
alter table public.part_lines add column if not exists unit_retail_cents integer;
alter table public.part_lines add column if not exists line_code text;
alter table public.part_lines add column if not exists price_basis text;

comment on column public.part_lines.unit_list_cents is
  'O''Reilly list price per unit, in cents, when captured. An input to the price suggestion, never what the customer pays.';
comment on column public.part_lines.unit_retail_cents is
  'The O''Reilly WALK-IN price per unit, in cents, as Jake looked it up. Feeds the walk-in estimate through walkin_samples.';
comment on column public.part_lines.line_code is
  'O''Reilly product line code. Pricing follows the product line, so the estimate groups by it.';
comment on column public.part_lines.price_basis is
  'How unit_charge_cents was arrived at (the quote_pricing rule, or manual). Null = set before migration 0070.';

-- Guard the two new money columns the way the rest of the app guards money:
-- a negative walk-in or list price is a typo, not a return. (unit_cost_cents
-- is deliberately allowed to go negative - that is how a return is recorded -
-- but a price the STORE charges a walk-in customer never is.)
alter table public.part_lines
  drop constraint if exists part_lines_list_nonneg;
alter table public.part_lines
  add constraint part_lines_list_nonneg
  check (unit_list_cents is null or unit_list_cents >= 0);
alter table public.part_lines
  drop constraint if exists part_lines_retail_nonneg;
alter table public.part_lines
  add constraint part_lines_retail_nonneg
  check (unit_retail_cents is null or unit_retail_cents >= 0);

create or replace view public.walkin_samples
with (security_invoker = true) as
  select line_code, unit_cost_cents, unit_list_cents, unit_retail_cents
    from public.quote_lines
   where unit_retail_cents is not null
     and unit_retail_cents > 0
  union all
  select line_code, unit_cost_cents, unit_list_cents, unit_retail_cents
    from public.part_lines
   where unit_retail_cents is not null
     and unit_retail_cents > 0;

comment on view public.walkin_samples is
  'Every walk-in price the shop has actually looked up, from quotes and from job part lines, as the walk-in estimate''s sample pool. security_invoker: the caller''s RLS applies, so this reads no more than the caller already could.';
