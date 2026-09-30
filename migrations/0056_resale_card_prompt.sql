-- 0056: the owner's answer to the one-time resale-card reminder.
--
-- TAX-3, the owner's answer on his 2026-09-29 sheet: "Ask once my first
-- return is filed". Once the July-September 2026 Juneau sales-tax return is
-- recorded as filed (a tax_filings row, 0053: obligation cbj_sales_tax, period
-- 2026-07-01..2026-09-30, filed_on set), the Taxes page shows a card and the
-- dashboard an 'info' door asking whether he has asked the city about a
-- resale card. His answer is kept here, on the single settings row, so the
-- question never comes back, on any device. The app never contacts the city.
--
-- WHAT THIS ADDS (both on public.settings, id 1):
--
--   resale_card_prompt     null = not answered yet (the reminder may show)
--                          asked  = "I asked the city"
--                          hidden = "Hide this"
--   resale_card_prompt_at  when he answered (the app writes it with the answer)
--
-- NULL passes a CHECK, and null is allowed here on purpose: it is "not
-- answered yet", the state every row starts in.
--
-- ORDER: either way round. The code (lib/sales-tax resalePromptDue) keeps the
-- reminder hidden while the column is missing, so it never shows a card whose
-- "Hide this" could not save. Land it before he records the Q3 return (the
-- city takes it through Mon Nov 2, 2026); a later landing still shows the
-- reminder, because it triggers on the recorded state, not on a date.
--
-- SECURITY: no new table, function or sequence, so no new grant. The columns
-- follow public.settings as it stands (measured 2026-09-30): RLS on, one
-- owner_all policy for authenticated on public.is_owner(), table grants to
-- authenticated and service_role only, and no table or column grant to anon
-- or PUBLIC. The customer-link functions (get_public_quote,
-- get_public_invoice, get_public_statement) read settings by NAMED column
-- inside jsonb_build_object (the business name, phone, address, email and
-- payment instructions), so neither new column can reach a customer.
-- The house revoke is at the end. It is column-level, because a table-level
-- revoke would also take anon's rights to the older columns, which is SEC-2's
-- job (0054), not this one's; it cannot undo a table-level grant, and there is
-- none to undo (PROOF 5).
--
-- REVERSIBLE: purely additive. Undo at the bottom.

alter table public.settings
  add column if not exists resale_card_prompt text;
alter table public.settings
  add column if not exists resale_card_prompt_at timestamptz;

alter table public.settings
  drop constraint if exists settings_resale_card_prompt_check;
alter table public.settings
  add constraint settings_resale_card_prompt_check
  check (resale_card_prompt is null or resale_card_prompt = any (array['asked'::text, 'hidden'::text]));

comment on column public.settings.resale_card_prompt is
  'TAX-3: the owner''s answer to the one-time resale-card reminder (asked | hidden). NULL = not answered yet; the reminder shows once the Jul-Sep 2026 CBJ return is recorded as filed. 0056.';
comment on column public.settings.resale_card_prompt_at is
  'TAX-3: when the owner answered the resale-card reminder. NULL = not answered yet. 0056.';

-- The house revoke: no column-level right to the answer for logged-out
-- visitors. (A TABLE-level grant to anon would still reach these columns;
-- there is none today, and PROOF 5 checks it.)
revoke all (resale_card_prompt, resale_card_prompt_at) on public.settings from anon;
revoke all (resale_card_prompt, resale_card_prompt_at) on public.settings from public;

-- PROOF, after applying. Read-only unless marked; the write tests roll back.
--
-- (1) both columns exist, nullable, and the one row starts unanswered:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'settings'
--      and column_name in ('resale_card_prompt', 'resale_card_prompt_at') order by 1;
--     -- resale_card_prompt text YES null; resale_card_prompt_at timestamp with time zone YES null
--   select id, resale_card_prompt, resale_card_prompt_at from public.settings;           -- 1, null, null
--
-- (2) the check, as the database holds it:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.settings'::regclass and conname = 'settings_resale_card_prompt_check';
--     -- CHECK (((resale_card_prompt IS NULL) OR (resale_card_prompt = ANY (ARRAY['asked'::text, 'hidden'::text]))))
--
-- (3) WRITE TEST, rolled back: a value outside the two is refused with 23514
--     (check_violation) naming settings_resale_card_prompt_check:
--   begin;
--   update public.settings set resale_card_prompt = 'x' where id = 1;                   -- ERROR 23514
--   rollback;
--
-- (4) WRITE TEST, rolled back: each real answer is accepted:
--   begin;
--   update public.settings set resale_card_prompt = 'asked', resale_card_prompt_at = now() where id = 1
--    returning resale_card_prompt;                                                      -- asked
--   update public.settings set resale_card_prompt = 'hidden' where id = 1
--    returning resale_card_prompt;                                                      -- hidden
--   rollback;
--   select resale_card_prompt, resale_card_prompt_at from public.settings;             -- null, null again
--
-- (5) access unchanged: logged-out visitors cannot read or write the answer,
--     the owner's sign-in can, and the table's policy is still owner-only.
--     (A comma list in has_*_privilege is true when ANY one is held.)
--   select has_table_privilege('anon', 'public.settings', 'SELECT,INSERT,UPDATE,DELETE');                   -- false
--   select has_column_privilege('anon', 'public.settings', 'resale_card_prompt', 'SELECT,INSERT,UPDATE');   -- false
--   select has_column_privilege('anon', 'public.settings', 'resale_card_prompt_at', 'SELECT,INSERT,UPDATE'); -- false
--   select has_column_privilege('authenticated', 'public.settings', 'resale_card_prompt', 'SELECT')
--      and has_column_privilege('authenticated', 'public.settings', 'resale_card_prompt', 'UPDATE')
--      and has_column_privilege('authenticated', 'public.settings', 'resale_card_prompt_at', 'UPDATE');    -- true
--   select policyname, roles, cmd, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename = 'settings';                            -- owner_all, {authenticated}, ALL, is_owner()
--
-- (6) the trigger's inputs, for when the reminder should appear (read-only):
--   select id, filed_on, paid_on from public.tax_filings
--    where obligation = 'cbj_sales_tax' and period_start = '2026-07-01' and period_end = '2026-09-30';
--     -- no row with filed_on set = no reminder yet (0 rows on 2026-09-30)
--
-- (7) the figure the card shows, to compare with the page (read-only;
--     $78.09 on 5 of 10 receipts, first 2026-07-23, measured 2026-09-30):
--   select sum(r.tax_cents) as cents, count(*) filter (where r.tax_cents > 0) as with_tax, count(*) as receipts
--     from public.receipts r join public.jobs j on j.id = r.job_id
--    where j.deleted_at is null and coalesce(r.purchase_date, j.date) >= '2026-07-01';
--
-- UNDO (loses his answer, so the reminder would show again once the return is filed):
--   alter table public.settings drop constraint if exists settings_resale_card_prompt_check;
--   alter table public.settings drop column if exists resale_card_prompt_at;
--   alter table public.settings drop column if exists resale_card_prompt;
