-- 0034: price once, when the quote is written.
--
-- Jake prices quotes off O'Reilly: the Pro site shows his cost and a "list"
-- price well above what a walk-in customer pays, so today he rebuilds every
-- quote on oreillyauto.com to find the walk-in price, and the quote line kept
-- only the final customer price. The receipt then re-priced the job with the
-- markup matrix after the customer had approved (J003: +$520).
--
-- Now a quote line can carry, owner-only:
--   unit_cost_cents   - Jake's O'Reilly Pro cost
--   unit_list_cents   - O'Reilly's list price from the Pro screen
--   unit_retail_cents - the walk-in price, when Jake checked it
--   line_code         - O'Reilly's line code (BBR, STD...) - walk-in prices
--                       track cost by product line, so estimates learn per line
--   price_basis       - how the customer price was set
-- and settings carry the shop's rule. Jake asked to match O'Reilly's walk-in
-- price "or not much more", so 'walkin' is the starting rule with a 0% bump.
--
-- None of this reaches a customer: get_public_quote and the approval snapshot
-- (respond_public_quote, Record approval) build their line JSON from named
-- keys that don't include these columns.

alter table public.quote_lines
  add column if not exists unit_cost_cents integer,
  add column if not exists unit_list_cents integer,
  add column if not exists unit_retail_cents integer,
  add column if not exists line_code text,
  add column if not exists price_basis text;

alter table public.quote_lines
  drop constraint if exists quote_lines_price_basis_check,
  add constraint quote_lines_price_basis_check
    check (price_basis is null or price_basis in ('walkin', 'matrix', 'cost_plus', 'cost', 'manual'));

comment on column public.quote_lines.unit_cost_cents is
  'Owner-only: the supplier (O''Reilly Pro) cost this line was priced from. Never on /q.';
comment on column public.quote_lines.unit_list_cents is
  'Owner-only: the supplier''s list price as shown on the Pro screen.';
comment on column public.quote_lines.unit_retail_cents is
  'Owner-only: the walk-in / online price Jake checked for this part. Feeds the walk-in estimate for the next quote.';
comment on column public.quote_lines.line_code is
  'Owner-only: the supplier line code (O''Reilly BBR, STD...).';
comment on column public.quote_lines.price_basis is
  'How the customer price was set: walkin, matrix, cost_plus, cost or manual.';

alter table public.settings
  add column if not exists quote_pricing text not null default 'walkin',
  add column if not exists quote_markup_pct integer not null default 0;

alter table public.settings
  drop constraint if exists settings_quote_pricing_check,
  add constraint settings_quote_pricing_check
    check (quote_pricing in ('walkin', 'matrix', 'cost_plus', 'cost', 'manual')),
  drop constraint if exists settings_quote_markup_pct_check,
  add constraint settings_quote_markup_pct_check
    check (quote_markup_pct between 0 and 300);

comment on column public.settings.quote_pricing is
  'How new quote lines are priced from the supplier figures: walkin (match the walk-in price, plus quote_markup_pct), matrix, cost_plus (cost + quote_markup_pct), cost, or manual.';
comment on column public.settings.quote_markup_pct is
  'walkin: percent above the walk-in price. cost_plus: percent above cost.';

alter table public.quotes
  add column if not exists source_path text;

comment on column public.quotes.source_path is
  'The supplier quote file (PDF or screenshot) this quote was read from, in the receipts bucket.';
