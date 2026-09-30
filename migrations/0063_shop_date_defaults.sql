-- 0063: dates the database fills in are Juneau's date, not UTC's.
--
-- invoices.issue_date, jobs.date, payments.date and expenses.date defaulted to
-- CURRENT_DATE, which is the UTC date: from 4 pm in Juneau (3 pm in winter) it
-- is already tomorrow. Eight invoices went out dated a day AFTER their due
-- date that way (INV-008, 009, 012, 013, 015, 016, 017, 019: the app writes
-- due_date from the local date, the database wrote issue_date in UTC).
-- shop_today() is the shop's own calendar day (America/Anchorage, the same
-- clock as Juneau), already used by the card-payment recorder.
--
-- Only NEW rows change. Issued invoices keep their dates: a customer's
-- document never changes after it is sent.
alter table public.invoices alter column issue_date set default public.shop_today();
alter table public.jobs     alter column date       set default public.shop_today();
alter table public.payments alter column date       set default public.shop_today();
alter table public.expenses alter column date       set default public.shop_today();

-- PROOF (after applying): all four read public.shop_today()
-- select table_name, column_name, column_default from information_schema.columns
--  where table_schema = 'public' and (table_name, column_name) in
--  (('invoices','issue_date'),('jobs','date'),('payments','date'),('expenses','date'));
-- ROLLBACK: the same four statements with "set default current_date".
