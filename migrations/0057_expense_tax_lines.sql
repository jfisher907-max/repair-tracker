-- 0057: every expense sits on a federal Schedule C line.
--
-- EXP-2, the owner's answer on his decision sheet (2026-09-29): "Yes, and
-- move the 4 existing expenses".
--
-- WHAT THIS CHANGES
--
--   public.expenses.category holds a stable KEY tied to a Schedule C line
--   ('taxes_licenses', 'software', ...), guarded by a CHECK. The line NUMBERS
--   per tax year live in lib/schedule-c.ts, not here, because the 2026 draft
--   form renumbers interest (16b -> 16c). description stays the free-text memo.
--   Amount, date, vendor and description are untouched, so the $468.99 total
--   and every profit figure read the same afterwards.
--
-- ORDER MATTERS. public.book_stripe_fee (0022) inserts the category
-- 'Software & fees' and runs BEFORE the payment insert inside
-- record_card_payment and record_deposit_payment, with no exception handler.
-- Adding the CHECK first would make every card payment and online deposit
-- fail to record, and Stripe's retries would fail the same way forever. So
-- step 1 switches it to the new key before anything else, and the CHECK is
-- the very last thing added. Each step is safe on its own if the apply stops
-- partway; a single run is one transaction anyway.
--
-- DEPLOY ORDER: the app code that writes keys (and reads old labels) ships
-- FIRST; apply this after it is live. The old page wrote 'Other', which the
-- CHECK refuses.
--
-- NOTHING NEW TO GRANT: no table, sequence or function is created. The one
-- function replaced keeps its measured ACL (postgres + service_role EXECUTE;
-- CREATE OR REPLACE never changes privileges), and the 0022 revokes are
-- repeated so it can never be reached directly.
--
-- BEFORE APPLYING (read-only; both must match or the apply will stop itself):
--
--   -- (a) the four rows the ruling moves: expect exactly these four
--   select id, date, category, amount_cents from public.expenses
--    where id in ('c22df695-7883-4c3c-b6b8-a7cc0b830012', '86e4e827-b614-4e49-8cd7-1905eb2cceb0',
--                 'c83452c3-f730-4855-b848-e35551a06522', 'bd254d88-4264-4aa7-94c2-98ca2356a3be')
--    order by id;
--   --   86e4e827… 2026-08-18 Other      10500
--   --   bd254d88… 2026-08-21 Licensing  10000
--   --   c22df695… 2026-08-18 Other       1399
--   --   c83452c3… 2026-08-21 Licensing  25000
--   --   (a category that is already a line key also passes: the owner
--   --   picked it in the new code, and step 2 leaves it as he set it)
--   -- (b) rows no step below can place on a line: expect 0
--   select count(*) from public.expenses
--    where category <> all (array['advertising','car_truck','commissions_fees','contract_labor',
--      'equipment_large','insurance','interest','legal_professional','office','rent_equipment',
--      'rent_property','repairs','supplies','taxes_licenses','travel','meals','utilities',
--      'software','equipment_small','card_fees','startup','other',
--      'Shop supplies','Insurance','Rent','Utilities','Advertising','Licensing',
--      'Software & fees','Tools & equipment','Other']::text[]);

-- ------------------------------------------------------------------------
-- 1. The card-fee booker writes the new key. Same signature, same body as
--    0022 apart from the category.
-- ------------------------------------------------------------------------

create or replace function public.book_stripe_fee(
  p_external_ref text,
  p_fee_cents    integer,
  p_label        text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_fee_cents is null or p_fee_cents <= 0 then
    return;
  end if;
  insert into expenses (date, category, vendor, description, amount_cents, external_ref)
  values (shop_today(), 'card_fees', 'Stripe', p_label, p_fee_cents, p_external_ref)
  on conflict (external_ref) where external_ref is not null do nothing;
end;
$$;

-- Internal helper only (0022): the definer recorders call it as the owner.
revoke all on function public.book_stripe_fee(text, integer, text) from public;
revoke all on function public.book_stripe_fee(text, integer, text) from anon;
revoke all on function public.book_stripe_fee(text, integer, text) from authenticated;

-- ------------------------------------------------------------------------
-- 2. The four rows the ruling moves, by id (measured 2026-09-29). Refuse,
--    never guess: if any of them is missing, or its date or amount is not
--    what the owner approved, or it sits on a label that is neither its
--    approved one nor a line key, stop here and change nothing more.
--
--    A row already on ANY line key passes, not only its approved one. The
--    new code ships first and asks the owner to pick a line for these rows
--    (the Expenses page will not save an edit to one until he does), so he
--    may have put the $250 'LLC License' under start-up costs, or the domain
--    under another line, before this runs. That later choice is his and it
--    stands: the two UPDATEs below touch only a row still on its approved
--    before-label, so a re-picked row (or a re-run) is left alone.
--
--    c22df695… 2026-08-18 Vercel      'Website domain'    $13.99  Other     -> software       (27b, Part V)
--    86e4e827… 2026-08-18 Anthropic   'Claude sub'       $105.00  Other     -> software       (27b, Part V)
--    c83452c3… 2026-08-21 Alaska.Gov  'LLC License'      $250.00  Licensing -> taxes_licenses (23)
--    bd254d88… 2026-08-21 Alaska.gov  'Business License' $100.00  Licensing -> taxes_licenses (23)
-- ------------------------------------------------------------------------

do $$
declare
  r record;
  v record;
  -- the 22 keys the CHECK in step 5 allows
  line_keys constant text[] := array['advertising','car_truck','commissions_fees','contract_labor',
    'equipment_large','insurance','interest','legal_professional','office','rent_equipment',
    'rent_property','repairs','supplies','taxes_licenses','travel','meals','utilities',
    'software','equipment_small','card_fees','startup','other'];
begin
  for r in
    select * from (values
      ('c22df695-7883-4c3c-b6b8-a7cc0b830012'::uuid, date '2026-08-18',  1399, 'Other'),
      ('86e4e827-b614-4e49-8cd7-1905eb2cceb0'::uuid, date '2026-08-18', 10500, 'Other'),
      ('c83452c3-f730-4855-b848-e35551a06522'::uuid, date '2026-08-21', 25000, 'Licensing'),
      ('bd254d88-4264-4aa7-94c2-98ca2356a3be'::uuid, date '2026-08-21', 10000, 'Licensing')
    ) as t(id, on_date, cents, before_cat)
  loop
    select e.date, e.amount_cents, e.category into v from public.expenses e where e.id = r.id;
    if not found then
      raise exception 'EXP-2: expense % is gone; the ruling moved four named rows. Check it by hand, then re-run', r.id;
    end if;
    if v.date <> r.on_date or v.amount_cents <> r.cents then
      raise exception 'EXP-2: expense % now reads % / % cents, not % / % cents as approved. Check it by hand, then re-run',
        r.id, v.date, v.amount_cents, r.on_date, r.cents;
    end if;
    if v.category <> r.before_cat and not (v.category = any (line_keys)) then
      raise exception 'EXP-2: expense % has category %, neither % (approved before) nor a tax-form line key. Check it by hand, then re-run',
        r.id, v.category, r.before_cat;
    end if;
  end loop;
end $$;

update public.expenses set category = 'software'
 where id in ('c22df695-7883-4c3c-b6b8-a7cc0b830012', '86e4e827-b614-4e49-8cd7-1905eb2cceb0')
   and category = 'Other';
update public.expenses set category = 'taxes_licenses'
 where id in ('c83452c3-f730-4855-b848-e35551a06522', 'bd254d88-4264-4aa7-94c2-98ca2356a3be')
   and category = 'Licensing';

-- ------------------------------------------------------------------------
-- 3. Rows added since under an old label, only where the label names ONE
--    line. 0 such rows on 2026-09-29; this is for anything typed between
--    then and the apply. NOT mapped, so step 4 stops on them and they are set
--    by hand:
--      'Parts & materials' - parts resold on jobs are cost of goods sold
--                            (Part III), not line 22 supplies.
--      'Fuel & travel'     - a vehicle (9) OR travel (24a).
--      anything typed free-hand.
-- ------------------------------------------------------------------------

update public.expenses set category = case
    when category = 'Shop supplies' then 'supplies'
    when category = 'Insurance'     then 'insurance'
    when category = 'Rent'          then 'rent_property'
    when category = 'Utilities'     then 'utilities'
    when category = 'Advertising'   then 'advertising'
    when category = 'Licensing'     then 'taxes_licenses'
    -- a Stripe fee carries its PaymentIntent id; one typed by hand does not
    when category = 'Software & fees' and external_ref is not null then 'card_fees'
    when category = 'Software & fees' then 'software'
    when category = 'Tools & equipment' and amount_cents <= 250000 then 'equipment_small'
    when category = 'Tools & equipment' then 'equipment_large'
    when category = 'Other'         then 'other'
    else category end
 where category in ('Shop supplies', 'Insurance', 'Rent', 'Utilities', 'Advertising',
                    'Licensing', 'Software & fees', 'Tools & equipment', 'Other');

-- ------------------------------------------------------------------------
-- 4. Refuse, never guess: any row still off the list stops the apply here,
--    BEFORE the CHECK exists.
-- ------------------------------------------------------------------------

do $$
declare n integer;
begin
  select count(*) into n from public.expenses
   where category <> all (array['advertising','car_truck','commissions_fees','contract_labor',
     'equipment_large','insurance','interest','legal_professional','office','rent_equipment',
     'rent_property','repairs','supplies','taxes_licenses','travel','meals','utilities',
     'software','equipment_small','card_fees','startup','other']::text[]);
  if n > 0 then
    raise exception 'EXP-2: % expense row(s) have a category with no single tax-form line; set them by hand, then re-run', n;
  end if;
end $$;

-- ------------------------------------------------------------------------
-- 5. The default and the guard. category is NOT NULL, so the CHECK cannot be
--    passed with a null.
-- ------------------------------------------------------------------------

alter table public.expenses alter column category set default 'other';
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category = any (array['advertising','car_truck','commissions_fees','contract_labor',
     'equipment_large','insurance','interest','legal_professional','office','rent_equipment',
     'rent_property','repairs','supplies','taxes_licenses','travel','meals','utilities',
     'software','equipment_small','card_fees','startup','other']::text[]));

comment on column public.expenses.category is
  'Schedule C line key (EXP-2, 0057). Line numbers per tax year: lib/schedule-c.ts. description is the free-text memo.';

-- ========================================================================
-- PROOF, after applying (read-only, or rolled back):
--
--   -- the guard, with 22 keys
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.expenses'::regclass and conname = 'expenses_category_check';
--
--   -- the four rows: software x2, taxes_licenses x2 (a row the owner had
--   -- already re-picked before the apply keeps his line instead, and the
--   -- per-key figures below shift by its amount; the total never does)
--   select id, date, category, amount_cents from public.expenses order by date, id;
--
--   -- per key: software 11899, taxes_licenses 35000; 46899 in all (unchanged)
--   select category, sum(amount_cents) from public.expenses group by 1 order by 1;
--   select sum(amount_cents) from public.expenses;
--
--   -- default: 'other'::text
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'expenses' and column_name = 'category';
--
--   -- the fee booker writes the key, and is still unreachable directly:
--   -- expect true, then {postgres=X/postgres,service_role=X/postgres}
--   select prosrc like '%''card_fees''%' and prosrc not like '%Software & fees%'
--     from pg_proc where oid = 'public.book_stripe_fee(text,integer,text)'::regprocedure;
--   select proacl::text from pg_proc where oid = 'public.book_stripe_fee(text,integer,text)'::regprocedure;
--   select has_function_privilege('anon', 'public.book_stripe_fee(text,integer,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.book_stripe_fee(text,integer,text)', 'EXECUTE');
--                                                                       -- false, false
--
--   -- refusal (writes nothing): must fail with 23514 expenses_category_check
--   begin;
--   insert into public.expenses (date, category, description, amount_cents)
--   values (current_date, 'Other', 'exp2 probe', 1);
--   rollback;
--
--   -- the card path still books (rolled back): must return card_fees
--   begin;
--   select public.book_stripe_fee('exp2_probe', 1, 'probe');
--   select category from public.expenses where external_ref = 'exp2_probe';
--   rollback;
--   select count(*) from public.expenses where external_ref = 'exp2_probe'; -- 0
--
--   -- the app: the dashboard's 2026 "After overhead" still reads $1,150.37.
--
-- UNDO (rows keyed after this migration keep their key unless mapped back by hand):
--   alter table public.expenses drop constraint if exists expenses_category_check;
--   alter table public.expenses alter column category set default 'Other';
--   update public.expenses set category = 'Other'
--    where id in ('c22df695-7883-4c3c-b6b8-a7cc0b830012', '86e4e827-b614-4e49-8cd7-1905eb2cceb0');
--   update public.expenses set category = 'Licensing'
--    where id in ('c83452c3-f730-4855-b848-e35551a06522', 'bd254d88-4264-4aa7-94c2-98ca2356a3be');
--   update public.expenses set category = 'Software & fees' where category = 'card_fees';
--   comment on column public.expenses.category is null;
--   -- and the 0022 fee booker:
--   create or replace function public.book_stripe_fee(p_external_ref text, p_fee_cents integer, p_label text)
--   returns void language plpgsql security definer set search_path = public as $f$
--   begin
--     if p_fee_cents is null or p_fee_cents <= 0 then return; end if;
--     insert into expenses (date, category, vendor, description, amount_cents, external_ref)
--     values (shop_today(), 'Software & fees', 'Stripe', p_label, p_fee_cents, p_external_ref)
--     on conflict (external_ref) where external_ref is not null do nothing;
--   end; $f$;
--   revoke all on function public.book_stripe_fee(text, integer, text) from public, anon, authenticated;
