-- 0047: the sales tax an invoice owes books itself, and an exemption is
-- recorded, not assumed.
--
-- The owner (2026-09-27): "make sure that fix will keep things accurate down
-- the road." Until now nothing wrote invoices.included_tax_cents except the
-- hand-run migrations 0042/0045, so the NEXT invoice that went out with no tax
-- line would have carried 0 — the shop's books would have understated the
-- tax owed to the City and Borough of Juneau by 5% of that invoice's price,
-- silently, until someone noticed and ran a backfill.
--
-- The rule (CBJ Sales Tax Procedure 130, see 0045; CBJ 69.05.070(b): the tax
-- is owed "whether or not collected from the buyer"): an invoice owes the
-- city's rate ON its selling price. When the invoice charged no tax line the
-- selling price is the whole invoiced price and the tax may not be backed out
-- of it. When it charged a tax line BELOW the city's rate (the draft's
-- "Sales tax %" editor accepts any value, e.g. 0.5 typed for 5), the rest is
-- still owed. Either way the customer paid only what the paper said, so the
-- shop pays the difference out of its own money. The only lawful reason for
-- an invoice to owe nothing is an exemption (a CBJ senior card, a
-- non-profit's card, work done outside the borough), and that has to be
-- written down.
--
-- 1. invoices.tax_exempt_note: the customer's exemption, e.g. "CBJ senior card
--    #1234". Null = no exemption. Never blank (a blank note is not an
--    exemption, and would read as one in Reports).
--
-- 2. invoices.included_tax_rate_bp: the city rate this invoice's tax was
--    booked at, PINNED the moment the invoice is issued (first reaches sent
--    or paid) and never changed by the trigger after that. Null on a draft
--    that has never been issued, and on a void draft. Books only.
--
-- 3. A BEFORE INSERT OR UPDATE trigger sets included_tax_cents:
--
--      not void AND total_cents > 0 AND no exemption note
--        -> included_tax_cents := greatest(0,
--             round((total_cents − tax_cents) × rate / 10000) − tax_cents)
--      otherwise
--        -> 0
--
--    total_cents − tax_cents is the selling price (lib/billing
--    buildInvoiceSnapshot: total = labor + parts + tax, tax on labor + parts).
--    With no tax line that is round(total × rate / 10000) — 0045's figure.
--    With a tax line at the city rate it is exactly 0 (the same rounding the
--    snapshot used). With a line below the rate it is the shortfall. A line
--    ABOVE the rate books 0 here; the whole line is still counted as tax in
--    Reports because the shop collected it.
--
--    rate = the invoice's pinned included_tax_rate_bp when it has one (it was
--    issued once, then fell back to draft — see below), else
--    settings.default_tax_rate_bp when > 0, else 500 (Juneau's 5%). Settings
--    at 0% means documents go out with no tax LINE; the shop still owes the
--    city, so the books never read 0 from it.
--
--    WHEN THE TRIGGER RECOMPUTES, AND WHEN IT DOES NOT:
--      · INSERT: always.
--      · UPDATE where OLD.status is sent, paid or void: NEVER. It returns NEW
--        exactly as the statement wrote it, so an UPDATE that does not name
--        the column carries the stored value through unchanged, and a later
--        change to the settings rate cannot rewrite what an issued invoice
--        owes. (A deliberate hand correction that names the column, like
--        0045, still works — the trigger does not fight it.)
--      · UPDATE of a draft: only when something the figure depends on moved —
--        status, total_cents, tax_cents or tax_exempt_note. A draft UPDATE
--        that only bumps updated_at, the memo or the due date leaves it alone.
--
--    THE PAID -> DRAFT FALLBACK. refresh_job_payment_cache (and lib/payments
--    syncJobPayment) put a PAID invoice that was never sent back to 'draft'
--    when its payments drop below its total — which is how a payment's date
--    or method gets corrected (delete, record again). INV-001, INV-008,
--    INV-009 and INV-018 are paid and never sent. Recording the payment again
--    takes the row draft -> paid, a status change, so the trigger recomputes.
--    Without a pinned rate that recompute would use whatever Settings says
--    THAT day, so after a real CBJ rate change, correcting a payment on an old
--    invoice would rewrite its booked tax. With the pin it recomputes at the
--    rate the invoice was issued at and lands on the same figure (the proof
--    below runs exactly this with Settings at 700). If the fallen-back draft
--    is re-snapshotted ("Update from job") its new price is still taxed at
--    the rate it was issued under.
--
--    Why each zero:
--      · exemption note -> 0: the sale is exempt; Reports lists it as Exempt.
--      · void -> 0: a void invoice governs nothing (job_totals, finances.ts
--        and Reports all skip it). A draft voided keeps nothing; an issued
--        invoice voided is frozen like any other issued invoice.
--      · total_cents = 0 -> 0: tax on nothing.
--    The multiplication is numeric: an amount × 500 overflows integer above
--    $42,949.67.
--
-- Trigger order on invoices: Postgres fires BEFORE ROW triggers in name order.
-- The only other trigger is invoices_updated_at (set_updated_at(): sets
-- NEW.updated_at = now() and nothing else; it is BEFORE UPDATE only). The new
-- one, invoices_book_included_tax, sorts before it and writes different
-- columns, reads none that set_updated_at writes, so either order produces the
-- same row. Nothing else writes included_tax_cents in a trigger.
--
-- What this migration writes to existing rows: included_tax_rate_bp = 500 on
-- the issued (sent / paid) invoices, and nothing else. Juneau's rate was 5%
-- when every one of them was issued, and each one's included_tax_cents
-- already equals the rule above at 500 (read 2026-09-27: the six untaxed ones
-- 750 / 3250 / 3275 / 2330 / 2825 / 1700 = 14130, the four taxed at 500 bp
-- with 0). That UPDATE fires the new trigger with OLD.status sent or paid, so
-- included_tax_cents is carried through untouched; invoices_updated_at bumps
-- updated_at on those rows, the only side effect. Void rows are left null.
-- Existing rows (read 2026-09-27): 12 invoices, none in draft — 10 paid, 2
-- void. The rolled-back proof is at the bottom of this file.

alter table public.invoices
  add column if not exists tax_exempt_note text null;

alter table public.invoices
  drop constraint if exists invoices_tax_exempt_note_not_blank;
-- CHECK passes on NULL (only FALSE fails): null = no exemption, which is
-- exactly the intent. A blank or whitespace-only note is refused.
alter table public.invoices
  add constraint invoices_tax_exempt_note_not_blank
    check (tax_exempt_note is null or btrim(tax_exempt_note) <> '');

comment on column public.invoices.tax_exempt_note is
  'Why this invoice legitimately owes no sales tax: the customer''s exemption (e.g. "CBJ senior card #1234", a non-profit''s card, work done outside the borough). Null = not exempt. Books and owner pages only; the public invoice RPC does not return it. With a note, included_tax_cents is 0, and with tax_cents = 0 as well Reports counts the sale as Exempt.';

alter table public.invoices
  add column if not exists included_tax_rate_bp integer null;

alter table public.invoices
  drop constraint if exists invoices_included_tax_rate_bp_positive;
-- Null = never issued (a draft, or a void draft). A pinned rate is a real rate.
alter table public.invoices
  add constraint invoices_included_tax_rate_bp_positive
    check (included_tax_rate_bp is null or included_tax_rate_bp > 0);

comment on column public.invoices.included_tax_rate_bp is
  'The city sales-tax rate (basis points) this invoice''s tax was booked at, pinned by the invoices_book_included_tax trigger (0047) the moment the invoice is first issued (sent or paid). If the invoice later falls back to draft (payments removed), any recompute uses this rate, never the current Settings rate. Null on a never-issued draft. Books only; never shown to the customer.';

create or replace function public.book_included_sales_tax()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rate integer;
  v_tax  integer;
begin
  if tg_op = 'UPDATE' then
    -- Issued (sent / paid) or void: frozen. Return the row exactly as the
    -- statement wrote it; an UPDATE that does not name included_tax_cents
    -- carries the stored value through untouched.
    if old.status is distinct from 'draft' then
      return new;
    end if;
    -- A draft whose inputs did not move keeps its figure.
    if new.status is not distinct from old.status
       and new.total_cents is not distinct from old.total_cents
       and new.tax_cents is not distinct from old.tax_cents
       and new.tax_exempt_note is not distinct from old.tax_exempt_note then
      return new;
    end if;
    -- Issued once, fell back to draft: the rate it was issued at.
    v_rate := old.included_tax_rate_bp;
  end if;

  if v_rate is null then
    select case when s.default_tax_rate_bp > 0 then s.default_tax_rate_bp else 500 end
      into v_rate
      from public.settings s
     limit 1;
    v_rate := coalesce(v_rate, 500);
  end if;

  v_tax := coalesce(new.tax_cents, 0);
  if coalesce(new.total_cents, 0) > 0
     and nullif(btrim(coalesce(new.tax_exempt_note, '')), '') is null
     and new.status is distinct from 'void' then
    new.included_tax_cents := greatest(
      0,
      round((new.total_cents - v_tax)::numeric * v_rate / 10000)::integer - v_tax
    );
  else
    new.included_tax_cents := 0;
  end if;

  -- Issued: pin the rate. From here on a recompute can only use this rate.
  if new.status in ('sent', 'paid') then
    new.included_tax_rate_bp := v_rate;
  end if;
  return new;
end;
$$;

comment on function public.book_included_sales_tax() is
  'BEFORE INSERT OR UPDATE on invoices (0047). On insert, and on a draft whose status, total, tax or exemption changed: included_tax_cents = greatest(0, round((total − tax) × rate / 10000) − tax) when it has a total, is not void and has no tax_exempt_note; else 0. rate = the pinned included_tax_rate_bp, else settings.default_tax_rate_bp when > 0, else 500. Pins included_tax_rate_bp when the invoice reaches sent or paid. Once OLD.status is sent, paid or void it never changes either column again.';

drop trigger if exists invoices_book_included_tax on public.invoices;
create trigger invoices_book_included_tax
  before insert or update on public.invoices
  for each row execute function public.book_included_sales_tax();

comment on column public.invoices.included_tax_cents is
  'Sales tax the shop owes on an invoice beyond any tax line it charged: the city rate on the selling price (total − tax_cents) less the tax line. With no tax line that is 5% of the whole invoiced price (CBJ Procedure 130: tax may not be backed out of a price that billed none); with a line below the rate it is the shortfall. The customer paid the invoice only, so the shop pays this out of its own money. Never shown to the customer. 0 when the tax line is at or above the rate, when tax_exempt_note records an exemption, and on a void draft. Written automatically by the invoices_book_included_tax trigger (0047) at the pinned included_tax_rate_bp, else settings.default_tax_rate_bp (else 500); frozen once sent or paid. The six pre-0047 values were set by 0042 and corrected by 0045.';

-- Pin the issued invoices at the rate they were issued under (Juneau 5%).
-- The trigger sees OLD.status sent/paid and returns NEW as written, so
-- included_tax_cents does not move.
update public.invoices
   set included_tax_rate_bp = 500
 where status in ('sent', 'paid')
   and included_tax_rate_bp is null;

-- ---------------------------------------------------------------------------
-- Verify after applying (read-only):
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.invoices'::regclass and not tgisinternal order by 1;
--     -> invoices_book_included_tax, invoices_updated_at
--   select invoice_number, status, total_cents, tax_cents, included_tax_cents,
--          included_tax_rate_bp,
--          greatest(0, round((total_cents - tax_cents)::numeric * 500 / 10000)::int - tax_cents) as rule_at_500
--     from public.invoices order by 1;
--     -> the ten paid rows: included_tax_rate_bp 500 and included_tax_cents =
--        rule_at_500 (the six untaxed sum to 14130, the four taxed are 0);
--        the two void rows (INV-012, INV-016): rate null, included 0.
--
-- PROOF (run by hand, in a transaction that always rolls back — it ends with
-- a RAISE, so nothing it does survives). It touches every existing row the
-- ways the app and the payment RPCs do, then checks included_tax_cents did not
-- move on any of them, then exercises the draft rules on a scratch copy.
--
--   do $proof$
--   declare
--     v_moved int;
--     v_draft uuid;
--     v_val int;
--   begin
--     create temp table _before on commit drop as
--       select id, included_tax_cents from public.invoices;
--
--     -- 1. every existing row: an updated_at bump, a no-op status write, a
--     --    paid_at write — what syncJobPayment / refresh_job_payment_cache do.
--     update public.invoices set updated_at = now();
--     update public.invoices set status = status;
--     update public.invoices set paid_at = paid_at;
--     select count(*) into v_moved
--       from public.invoices i join _before b using (id)
--      where i.included_tax_cents is distinct from b.included_tax_cents;
--     if v_moved <> 0 then raise exception 'FAIL: % existing rows moved', v_moved; end if;
--
--     -- 2. a CBJ rate change, then the paid -> draft -> paid round trip that
--     --    correcting a payment makes, on two never-sent legacy invoices, with
--     --    an unrelated write in between: still 3275 and 750.
--     update public.settings set default_tax_rate_bp = 700;
--     update public.invoices set status = 'draft', paid_at = null where invoice_number in ('INV-009', 'INV-001');
--     update public.invoices set memo = coalesce(memo, '') where invoice_number in ('INV-009', 'INV-001');
--     update public.invoices set status = 'paid', paid_at = now() where invoice_number in ('INV-009', 'INV-001');
--     select included_tax_cents into v_val from public.invoices where invoice_number = 'INV-009';
--     if v_val <> 3275 then raise exception 'FAIL: INV-009 moved to %', v_val; end if;
--     select included_tax_cents into v_val from public.invoices where invoice_number = 'INV-001';
--     if v_val <> 750 then raise exception 'FAIL: INV-001 moved to %', v_val; end if;
--
--     -- 3. the same rate change cannot reach any issued invoice.
--     update public.invoices set updated_at = now() where status in ('sent', 'paid');
--     select count(*) into v_moved
--       from public.invoices i join _before b using (id)
--      where i.included_tax_cents is distinct from b.included_tax_cents;
--     if v_moved <> 0 then raise exception 'FAIL: rate change moved % rows', v_moved; end if;
--     update public.settings set default_tax_rate_bp = 500;
--
--     -- 4. a new untaxed draft books 5%; an exemption zeroes it; clearing the
--     --    exemption books it again; a tax line at the rate zeroes it; a line
--     --    below the rate books the shortfall; sending pins and freezes it.
--     insert into public.invoices (invoice_number, job_id, customer_id, customer_name,
--            vehicle_label, job_title, issue_date, due_date, status, lines,
--            labor_hours, labor_rate_cents, labor_cents, parts_cents,
--            tax_rate_bp, tax_cents, total_cents)
--     select 'PROOF-0047', job_id, customer_id, customer_name, vehicle_label, job_title,
--            issue_date, due_date, 'draft', lines, labor_hours, labor_rate_cents,
--            labor_cents, parts_cents, 0, 0, 20000
--       from public.invoices where invoice_number = 'INV-018'
--     returning id into v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 1000 then raise exception 'FAIL: new draft booked %', v_val; end if;
--     update public.invoices set tax_exempt_note = 'CBJ senior card #1234' where id = v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 0 then raise exception 'FAIL: exempt draft booked %', v_val; end if;
--     update public.invoices set tax_exempt_note = null where id = v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 1000 then raise exception 'FAIL: un-exempted draft booked %', v_val; end if;
--     update public.invoices set tax_rate_bp = 500, tax_cents = 1000, total_cents = 21000 where id = v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 0 then raise exception 'FAIL: taxed draft booked %', v_val; end if;
--     update public.invoices set tax_rate_bp = 50, tax_cents = 100, total_cents = 20100 where id = v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 900 then raise exception 'FAIL: 0.5%% draft booked %, expected 900', v_val; end if;
--     update public.invoices set tax_rate_bp = 0, tax_cents = 0, total_cents = 20000 where id = v_draft;
--     update public.invoices set status = 'sent', sent_at = now() where id = v_draft;
--     select included_tax_rate_bp into v_val from public.invoices where id = v_draft;
--     if v_val is distinct from 500 then raise exception 'FAIL: sent invoice pinned %', v_val; end if;
--     update public.settings set default_tax_rate_bp = 700;
--     update public.invoices set updated_at = now() where id = v_draft;
--     select included_tax_cents into v_val from public.invoices where id = v_draft;
--     if v_val <> 1000 then raise exception 'FAIL: sent invoice moved to %', v_val; end if;
--
--     raise exception 'PROOF PASSED (this exception rolls everything back)';
--   end
--   $proof$;
--
-- Expected output: ERROR: PROOF PASSED (this exception rolls everything back).
-- Any "FAIL:" message names the rule that broke. (PROOF-0047 must not collide
-- with a real invoice_number; the insert copies INV-018's customer fields
-- only so the NOT NULL columns are satisfied.)
--
-- UNDO (the columns' values stay as written; only the automation goes):
--   drop trigger if exists invoices_book_included_tax on public.invoices;
--   drop function if exists public.book_included_sales_tax();
--   -- and, only if nothing reads them any more:
--   alter table public.invoices drop constraint if exists invoices_tax_exempt_note_not_blank;
--   alter table public.invoices drop column if exists tax_exempt_note;
--   alter table public.invoices drop constraint if exists invoices_included_tax_rate_bp_positive;
--   alter table public.invoices drop column if exists included_tax_rate_bp;
