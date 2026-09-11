-- 0030: receipts FILL the approved lines instead of adding beside them.
--
-- Until now a quote became a job as "placeholder" part lines (cost 0, charge
-- = the approved price, no link back to the quote), and the receipt scan
-- INSERTED brand-new lines beside them, priced by the markup matrix. Measured
-- 2026-09-11: J014's next scan would have billed its brake parts twice, J003
-- drifted $520.19 over what the customer approved, and J004 (paid) still
-- reads $0 parts cost, so its whole $655 counts as profit.
--
-- Now:
--   * convert/apply stamp each approved line with the quote line it came from
--     (quote_line_id) and tag it awaiting_cost;
--   * fill_receipt writes the receipt's COST onto those lines. It never
--     touches the approved charge, and the only wording change it makes is
--     swapping a substituted part number at the end of the description, so
--     the invoice names the part actually installed;
--   * receipt rows that weren't on the quote become the shop's own cost
--     (on_invoice = false, charge exactly 0) instead of new customer charges;
--   * the receipt records when it was saved, so a retried Save can never add
--     the counter tax, a core or freight twice.
--
-- The money math is untouched: an off-invoice line charges exactly 0, so
-- job_totals and lib/calc.ts computeTotals need no change.

-- ---------------------------------------------------------------- part_lines

alter table public.part_lines
  add column if not exists quote_line_id uuid references public.quote_lines(id) on delete set null,
  add column if not exists awaiting_cost boolean not null default false,
  add column if not exists on_invoice boolean not null default true,
  add column if not exists substituted_from text,
  add column if not exists receipt_description text;

comment on column public.part_lines.quote_line_id is
  'The approved quote line this part carries onto the job. Stamped by convert_quote_to_job / apply_quote_to_job.';
comment on column public.part_lines.awaiting_cost is
  'An approved (or template) part not yet costed from a receipt. Cleared automatically the moment a real cost is written.';
comment on column public.part_lines.on_invoice is
  'False = the shop''s own cost (a core deposit, unquoted freight, an extra part). Never printed, never billed; such a line always charges exactly 0.';
comment on column public.part_lines.substituted_from is
  'The quoted part number when the part actually installed differs. Owner-only.';
comment on column public.part_lines.receipt_description is
  'The store''s own wording for this part, as printed on the receipt. Owner-only; the customer keeps the approved wording.';

create index if not exists part_lines_quote_line_idx on public.part_lines (quote_line_id);
create index if not exists part_lines_awaiting_idx on public.part_lines (job_id) where awaiting_cost;

-- A CHECK passes when its expression is NULL, and a NULL charge means "bill
-- at cost" in the generated line_charge_total_cents. So the off-invoice rule
-- compares through coalesce: a hidden line with a NULL charge would bill.
alter table public.part_lines
  drop constraint if exists part_lines_awaiting_has_no_cost,
  add constraint part_lines_awaiting_has_no_cost
    check (not awaiting_cost or unit_cost_cents = 0),
  drop constraint if exists part_lines_off_invoice_charges_nothing,
  add constraint part_lines_off_invoice_charges_nothing
    check (on_invoice or coalesce(unit_charge_cents, -1) = 0);

-- The tag means "no cost yet", enforced here rather than in any one screen:
-- every write that gives a tagged line a real cost settles it, whichever path
-- it came through (receipt fill, the job page's Enter cost, a SQL fix).
create or replace function public.part_lines_clear_awaiting_cost()
returns trigger
language plpgsql
as $$
begin
  if new.awaiting_cost and new.unit_cost_cents <> 0 then
    new.awaiting_cost := false;
  end if;
  return new;
end
$$;

drop trigger if exists part_lines_clear_awaiting_cost on public.part_lines;
create trigger part_lines_clear_awaiting_cost
  before insert or update of unit_cost_cents, awaiting_cost on public.part_lines
  for each row execute function public.part_lines_clear_awaiting_cost();

-- ------------------------------------------------------------------ receipts

alter table public.receipts
  add column if not exists saved_at timestamptz,
  add column if not exists balance_note text,
  add column if not exists po_ref text,
  add column if not exists vendor_invoice_no text;

comment on column public.receipts.saved_at is
  'When the review screen saved this receipt. Null = uploaded but never finished (it can be resumed).';
comment on column public.receipts.balance_note is
  'Why this receipt''s lines + tax don''t equal its printed total, when they don''t.';
comment on column public.receipts.po_ref is
  'The PO printed on the supplier ticket - the app''s job number (J014) or quote number (Q008).';
comment on column public.receipts.vendor_invoice_no is
  'The supplier''s own invoice / ticket number, for spotting the same ticket entered twice.';

-- --------------------------------------------------------------- quote_lines

alter table public.quote_lines
  add column if not exists part_number text;

comment on column public.quote_lines.part_number is
  'The supplier part number this line was priced from. Owner-only: get_public_quote and the approval snapshot list their line keys explicitly and never include it.';

-- ----------------------------------------------------- convert_quote_to_job
-- Same as 0019 with two changes: the job is dated shop_today() (the column
-- default CURRENT_DATE is UTC, so a quote converted after ~4 pm in Juneau was
-- dated tomorrow), and each placeholder carries quote_line_id + awaiting_cost.
-- Still SECURITY INVOKER, still idempotent, still callable headless by
-- record_deposit_payment for the Stripe deposit webhook.

create or replace function public.convert_quote_to_job(p_quote_id uuid) returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_quote record;
  v_job   uuid;
begin
  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote not found';
  end if;
  if v_quote.job_id is not null then
    return v_quote.job_id;
  end if;
  if v_quote.vehicle_id is null then
    raise exception 'set a vehicle on this quote first — jobs are always tied to a vehicle';
  end if;

  insert into jobs (vehicle_id, date, title, work_performed, labor_hours, labor_rate_cents, notes)
  values (v_quote.vehicle_id, shop_today(), v_quote.title, v_quote.description,
          v_quote.labor_hours, v_quote.labor_rate_cents,
          'From quote ' || v_quote.quote_number)
  returning id into v_job;

  insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents,
                          quote_line_id, awaiting_cost)
  select v_job, l.description, l.qty, 0, l.unit_charge_cents, l.id, true
    from quote_lines l
   where l.quote_id = p_quote_id and not l.declined
   order by l.created_at;

  insert into recommendations (job_id, vehicle_id, description, estimate_cents, status)
  select v_job, v_quote.vehicle_id,
         l.description || ' (declined on ' || v_quote.quote_number || ')',
         l.line_total_cents, 'open'
    from quote_lines l
   where l.quote_id = p_quote_id and l.declined
   order by l.created_at;

  update quotes
     set job_id = v_job, applied_at = now()
   where id = p_quote_id;

  return v_job;
end;
$$;

-- ------------------------------------------------------- apply_quote_to_job
-- Same as 0015; the only change is the two stamped columns on the insert.

create or replace function public.apply_quote_to_job(p_quote_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  q record;
  j record;
  scope_note text;
  approved_charges integer;
begin
  select * into q from quotes where id = p_quote_id and deleted_at is null for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.job_id is null then raise exception 'This quote is not linked to a job'; end if;
  if q.applied_at is not null then raise exception 'This quote was already applied'; end if;

  select * into j from jobs where id = q.job_id and deleted_at is null for update;
  if not found then raise exception 'The job this quote belongs to no longer exists'; end if;

  if q.status <> 'declined' then
    insert into part_lines (job_id, description, qty, unit_cost_cents, unit_charge_cents,
                            quote_line_id, awaiting_cost)
    select q.job_id, l.description, l.qty, 0, l.unit_charge_cents, l.id, true
    from quote_lines l
    where l.quote_id = q.id and not l.declined;

    select coalesce(sum(l.line_total_cents), 0) into approved_charges
    from quote_lines l
    where l.quote_id = q.id and not l.declined;

    scope_note := '+ ' || q.title || ' (authorized via ' || q.quote_number || ')';
    update jobs set
      labor_hours = j.labor_hours + q.labor_hours,
      work_performed = case
        when j.work_performed is null or j.work_performed = '' then scope_note
        else j.work_performed || E'\n' || scope_note
      end,
      parts_charged_override_cents = case
        when j.parts_charged_override_cents is null then null
        else j.parts_charged_override_cents + approved_charges
      end
    where id = j.id;
  end if;

  insert into recommendations (job_id, vehicle_id, description, estimate_cents, status)
  select q.job_id, q.vehicle_id,
         l.description || ' (declined on ' || q.quote_number || ')',
         l.line_total_cents, 'open'
  from quote_lines l
  where l.quote_id = q.id and (l.declined or q.status = 'declined');

  update quotes set applied_at = now() where id = q.id;
end
$$;

-- -------------------------------------------------------------- fill_receipt
-- Saves one reviewed receipt in a single transaction. p_rows is an array of
--   { kind: 'fill'|'cost_only'|'billed'|'tax', target_line_id?, description,
--     part_number?, qty, unit_cost_cents, unit_charge_cents? }
--   fill      - writes cost onto an awaiting approved line (never its charge)
--   cost_only - the shop's own cost, off the invoice (charge 0)
--   billed    - a new customer charge (refused once an invoice is sent/paid)
--   tax       - counter sales tax: added to receipts.tax_cents, never a line

create or replace function public.fill_receipt(p_receipt_id uuid, p_header jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rec       receipts%rowtype;
  v_job       jobs%rowtype;
  v_locked    boolean;
  v_row       jsonb;
  v_kind      text;
  v_slot      part_lines%rowtype;
  v_qty       numeric;
  v_cost      integer;
  v_pn        text;
  v_desc      text;
  v_qpn       text;
  v_npn       text;
  v_nqpn      text;
  v_new_desc  text;
  v_sub       text;
  v_store     text := nullif(btrim(coalesce(p_header->>'store', '')), '');
  v_date      date := nullif(p_header->>'purchase_date', '')::date;
  v_total     integer := nullif(p_header->>'receipt_total_cents', '')::integer;
  v_tax       integer := coalesce(nullif(p_header->>'tax_cents', '')::integer, 0);
  v_note      text := nullif(btrim(coalesce(p_header->>'balance_note', '')), '');
  v_status    text := coalesce(nullif(p_header->>'extraction_status', ''), 'manual');
  v_lines_sum numeric := 0;
  v_filled    integer := 0;
  v_added     integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'receipt rows must be a list';
  end if;

  select * into v_rec from receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found';
  end if;

  select * into v_job from jobs where id = v_rec.job_id and deleted_at is null for update;
  if not found then
    raise exception 'the job for this receipt no longer exists';
  end if;

  -- Once only.
  if v_rec.saved_at is not null
     or exists (select 1 from part_lines where receipt_id = p_receipt_id) then
    raise exception 'this receipt was already saved';
  end if;

  -- A sent or paid invoice freezes what the customer owes: from here a
  -- receipt may add cost, never charge.
  v_locked := exists (select 1 from invoices
                       where job_id = v_job.id and status in ('sent', 'paid'));

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_kind := v_row->>'kind';
    v_qty  := coalesce(nullif(v_row->>'qty', '')::numeric, 1);
    v_cost := coalesce(nullif(v_row->>'unit_cost_cents', '')::integer, 0);
    v_pn   := nullif(btrim(coalesce(v_row->>'part_number', '')), '');
    v_desc := nullif(btrim(coalesce(v_row->>'description', '')), '');

    if v_qty <= 0 then
      raise exception 'quantities must be more than zero (a return is a negative cost)';
    end if;

    if v_kind = 'tax' then
      v_tax := v_tax + round(v_qty * v_cost)::integer;
      continue;
    end if;

    if v_desc is null then
      raise exception 'every receipt line needs a description';
    end if;
    v_lines_sum := v_lines_sum + round(v_qty * v_cost);

    if v_kind = 'fill' then
      select * into v_slot from part_lines
       where id = nullif(v_row->>'target_line_id', '')::uuid and job_id = v_job.id
       for update;
      if not found then
        raise exception 'that approved part is not on this job';
      end if;
      if not v_slot.awaiting_cost then
        raise exception '"%" already has its cost', v_slot.description;
      end if;

      -- The quoted part number: the quote line's own, else the " - NUMBER"
      -- ending on O'Reilly titles pasted into older quotes.
      v_qpn := coalesce(
        (select q.part_number from quote_lines q where q.id = v_slot.quote_line_id),
        substring(v_slot.description from ' - ([A-Za-z0-9][A-Za-z0-9-]{2,})$'));
      if v_qpn is not null and v_qpn !~ '[0-9]' then
        v_qpn := null;
      end if;

      v_sub := null;
      v_new_desc := v_slot.description;
      v_npn  := upper(regexp_replace(coalesce(v_pn, ''), '[^A-Za-z0-9]', '', 'g'));
      v_nqpn := upper(regexp_replace(coalesce(v_qpn, ''), '[^A-Za-z0-9]', '', 'g'));
      if v_npn <> '' and v_nqpn <> '' then
        -- Same part when equal, or when the only difference is a 2-4 letter
        -- store line code in front ("STD UF504" vs "UF504"). Mirrors samePart
        -- in lib/receipt-match.ts - a looser suffix test would call 2682B the
        -- same part as 19B2682B.
        if not (
             v_npn = v_nqpn
          or (length(v_npn) > length(v_nqpn)
              and right(v_npn, length(v_nqpn)) = v_nqpn
              and left(v_npn, length(v_npn) - length(v_nqpn)) ~ '^[A-Z]{2,4}$')
          or (length(v_nqpn) > length(v_npn)
              and right(v_nqpn, length(v_npn)) = v_npn
              and left(v_nqpn, length(v_nqpn) - length(v_npn)) ~ '^[A-Z]{2,4}$')
        ) then
          v_sub := v_qpn;
          if right(v_slot.description, length(' - ' || v_qpn)) = ' - ' || v_qpn then
            v_new_desc := left(v_slot.description,
                               length(v_slot.description) - length(' - ' || v_qpn))
                          || ' - ' || v_pn;
          end if;
        end if;
      end if;

      if v_qty < v_slot.qty then
        -- Bought part of it: the bought units become their own costed line
        -- and the rest keeps waiting. Units x charge still sum to what was
        -- approved, so the total cannot move.
        update part_lines set qty = v_slot.qty - v_qty where id = v_slot.id;
        insert into part_lines (job_id, receipt_id, purchase_date, store, part_number, description,
                                qty, unit_cost_cents, unit_charge_cents, quote_line_id,
                                awaiting_cost, on_invoice, substituted_from, receipt_description)
        values (v_job.id, p_receipt_id, v_date, v_store, v_pn, v_new_desc,
                v_qty, v_cost, v_slot.unit_charge_cents, v_slot.quote_line_id,
                false, v_slot.on_invoice, v_sub, v_desc);
        v_added := v_added + 1;
      else
        update part_lines
           set unit_cost_cents     = v_cost,
               part_number         = coalesce(v_pn, part_number),
               description         = v_new_desc,
               receipt_id          = p_receipt_id,
               store               = coalesce(v_store, store),
               purchase_date       = coalesce(v_date, purchase_date),
               receipt_description = v_desc,
               substituted_from    = v_sub,
               awaiting_cost       = false
         where id = v_slot.id;
        if v_qty > v_slot.qty then
          -- More units than the customer approved: the extras are the shop's
          -- cost until an OK puts them on the bill.
          insert into part_lines (job_id, receipt_id, purchase_date, store, part_number, description,
                                  qty, unit_cost_cents, unit_charge_cents, on_invoice)
          values (v_job.id, p_receipt_id, v_date, v_store, v_pn, v_desc || ' (extra)',
                  v_qty - v_slot.qty, v_cost, 0, false);
          v_added := v_added + 1;
        end if;
      end if;
      v_filled := v_filled + 1;

    elsif v_kind = 'cost_only' then
      insert into part_lines (job_id, receipt_id, purchase_date, store, part_number, description,
                              qty, unit_cost_cents, unit_charge_cents, on_invoice)
      values (v_job.id, p_receipt_id, v_date, v_store, v_pn, v_desc,
              v_qty, v_cost, 0, false);
      v_added := v_added + 1;

    elsif v_kind = 'billed' then
      if v_locked then
        raise exception 'this job already has a sent or paid invoice, so "%" can only go in as your own cost', v_desc;
      end if;
      insert into part_lines (job_id, receipt_id, purchase_date, store, part_number, description,
                              qty, unit_cost_cents, unit_charge_cents, on_invoice)
      values (v_job.id, p_receipt_id, v_date, v_store, v_pn, v_desc,
              v_qty, v_cost, nullif(v_row->>'unit_charge_cents', '')::integer, true);
      v_added := v_added + 1;

    else
      raise exception 'unknown receipt line kind: %', coalesce(v_kind, 'none');
    end if;
  end loop;

  if v_note is null and (v_total is null or v_lines_sum + v_tax <> v_total) then
    raise exception 'the lines and tax don''t add up to the printed total - fix a line, or say why';
  end if;

  if v_status not in ('extracted', 'manual') then
    v_status := 'manual';
  end if;

  update receipts
     set store               = v_store,
         purchase_date       = v_date,
         receipt_total_cents = v_total,
         tax_cents           = v_tax,
         extraction_status   = v_status,
         balance_note        = v_note,
         po_ref              = nullif(btrim(coalesce(p_header->>'po_ref', '')), ''),
         vendor_invoice_no   = nullif(btrim(coalesce(p_header->>'vendor_invoice_no', '')), ''),
         saved_at            = now()
   where id = p_receipt_id;

  -- Same rule as lib/payments.ts syncJobPayment: an empty ledger is left
  -- alone, or a job settled before payment tracking (J001) would flip back to
  -- unpaid.
  if exists (select 1 from payments where job_id = v_job.id) then
    perform refresh_job_payment_cache(v_job.id);
  end if;

  return jsonb_build_object('filled', v_filled, 'added', v_added, 'tax_cents', v_tax);
end
$$;

revoke all on function public.fill_receipt(uuid, jsonb, jsonb) from public;
revoke all on function public.fill_receipt(uuid, jsonb, jsonb) from anon;
grant execute on function public.fill_receipt(uuid, jsonb, jsonb) to authenticated;
