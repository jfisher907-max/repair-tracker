-- Phase 1: margin on parts, and a defensible record of who approved a quote.
--
-- 1. Parts markup matrix. A part line whose unit_charge_cents is null is sold
--    AT COST (lib/billing.ts falls back to unit_cost_cents), so anything not
--    hand-priced carries zero margin. The matrix fills the charge in at write
--    time — it never reinterprets rows already written, and the owner can
--    still override any line by hand.
--    Ships DISABLED with a starting table: nothing changes until it's reviewed.
--
-- 2. Quote approval attribution. Approval recorded only a status and a
--    timestamp, and editing a quote resets it to draft — so there was no
--    record of who agreed to what, and not even a copy of what they agreed to.
--    ESIGN/UETA and California BAR's Write It Right both want the same things:
--    intent, the name of the person authorising, when, how they were reached,
--    and a retained copy of the document as signed.

alter table public.settings
  add column if not exists parts_markup_enabled boolean not null default false,
  add column if not exists parts_markup_tiers jsonb not null default '[]'::jsonb;

comment on column public.settings.parts_markup_tiers is
  'Ordered [{up_to_cents:int|null, multiplier:numeric}]; first tier whose up_to_cents >= cost wins, null = the top open-ended tier.';

-- A starting point, not a recommendation — review before enabling.
update public.settings
   set parts_markup_tiers = '[
        {"up_to_cents": 500,   "multiplier": 3.0},
        {"up_to_cents": 2500,  "multiplier": 2.4},
        {"up_to_cents": 7500,  "multiplier": 2.0},
        {"up_to_cents": 15000, "multiplier": 1.8},
        {"up_to_cents": 30000, "multiplier": 1.6},
        {"up_to_cents": null,  "multiplier": 1.45}
      ]'::jsonb
 where parts_markup_tiers = '[]'::jsonb;

alter table public.quotes
  add column if not exists approved_by_name    text,
  add column if not exists approval_consent    boolean,
  add column if not exists approval_ip         text,
  add column if not exists approval_user_agent text,
  add column if not exists approved_snapshot   jsonb;

comment on column public.quotes.approved_snapshot is
  'Frozen copy of the quote exactly as responded to. Editing a quote resets it to draft; this survives that.';

-- Adding parameters changes the signature, so replace rather than CREATE OR
-- REPLACE. The new arguments all default, so an existing two-argument caller
-- keeps working through the deploy.
drop function if exists public.respond_public_quote(uuid, text);

create function public.respond_public_quote(
  token         uuid,
  response      text,
  p_name        text    default null,
  p_consent     boolean default null,
  p_ip          text    default null,
  p_user_agent  text    default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote    record;
  v_labor    integer;
  v_parts    integer;
  v_tax      integer;
  v_snapshot jsonb;
  new_status text;
begin
  if response not in ('approved', 'declined') then
    return null;
  end if;

  select * into v_quote
    from quotes
   where public_token = token and status = 'sent' and deleted_at is null;

  if not found then
    return null;
  end if;

  -- Mirrors computeQuoteTotals in lib/billing.ts.
  v_labor := round(coalesce(v_quote.labor_hours, 0) * coalesce(v_quote.labor_rate_cents, 0));
  select coalesce(sum(line_total_cents), 0) into v_parts
    from quote_lines where quote_id = v_quote.id;
  v_tax := round(((v_labor + v_parts) * coalesce(v_quote.tax_rate_bp, 0))::numeric / 10000);

  v_snapshot := jsonb_build_object(
    'quote_number',     v_quote.quote_number,
    'title',            v_quote.title,
    'description',      v_quote.description,
    'valid_until',      v_quote.valid_until,
    'labor_hours',      v_quote.labor_hours,
    'labor_rate_cents', v_quote.labor_rate_cents,
    'labor_cents',      v_labor,
    'parts_cents',      v_parts,
    'tax_rate_bp',      v_quote.tax_rate_bp,
    'tax_cents',        v_tax,
    'total_cents',      v_labor + v_parts + v_tax,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description',       l.description,
               'qty',               l.qty,
               'unit_charge_cents', l.unit_charge_cents,
               'line_total_cents',  l.line_total_cents)
             order by l.created_at)
        from quote_lines l where l.quote_id = v_quote.id), '[]'::jsonb),
    'response',   response,
    'by_name',    p_name,
    'frozen_at',  now()
  );

  update quotes
     set status              = response,
         decided_at          = now(),
         approved_by_name    = nullif(btrim(coalesce(p_name, '')), ''),
         approval_consent    = p_consent,
         approval_ip         = p_ip,
         approval_user_agent = left(coalesce(p_user_agent, ''), 400),
         approved_snapshot   = v_snapshot
   where id = v_quote.id
   returning status into new_status;

  return new_status;
end
$$;

revoke all on function public.respond_public_quote(uuid, text, text, boolean, text, text) from public;
grant execute on function public.respond_public_quote(uuid, text, text, boolean, text, text) to anon, authenticated;
