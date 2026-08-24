-- Photos on quotes AND invoices, chosen per photo.
--
-- job_photos.customer_visible was a single boolean with a single destination
-- (the quote page). The real workflow has two moments and two audiences:
--
--   quote   — "here is what we found", the evidence that justifies the work
--   invoice — "here is what we did", the record attached to the bill
--
-- A photo of a cracked boot belongs on the quote; a photo of the new part
-- fitted belongs on the invoice; some belong on both and most belong on
-- neither. One flag cannot say that, so there are now two.
--
-- customer_visible is left in place, deprecated, rather than dropped — it is
-- still in the backup export and dropping a column is not reversible. Nothing
-- reads it after this migration.

alter table public.job_photos
  add column if not exists show_on_quote boolean not null default false,
  add column if not exists show_on_invoice boolean not null default false;

-- Anything already shared with a customer was shared on a quote.
update public.job_photos set show_on_quote = true
 where customer_visible and not show_on_quote;

comment on column public.job_photos.customer_visible is
  'DEPRECATED — superseded by show_on_quote / show_on_invoice. Kept for the backup export; nothing reads it.';
comment on column public.job_photos.show_on_quote is
  'Visible to anyone holding this job''s quote link.';
comment on column public.job_photos.show_on_invoice is
  'Visible to anyone holding this job''s invoice link.';

-- ---------------------------------------------------------------------------
-- Which photos may the holder of this token see?
--
-- The token is the key and the ONLY key: a quote link exposes quote-flagged
-- photos of that quote's job, an invoice link exposes invoice-flagged photos
-- of that invoice's job, and a token that matches nothing yields nothing (the
-- job_id comparison goes NULL, which is not true). service_role only — the
-- server route is the sole caller, so no storage grant is ever handed to anon.
-- ---------------------------------------------------------------------------

create or replace function public.get_shared_photos(p_token uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('path', p.storage_path, 'caption', p.caption)
              order by p.created_at),
    '[]'::jsonb)
    from job_photos p
   where case p_kind
           when 'quote' then
             p.show_on_quote and p.job_id = (
               select q.job_id from quotes q
                where q.public_token = p_token and q.deleted_at is null)
           when 'invoice' then
             p.show_on_invoice and p.job_id = (
               select i.job_id from invoices i
                where i.public_token = p_token and i.status <> 'void')
           else false
         end
$$;

revoke all on function public.get_shared_photos(uuid, text) from public;
revoke all on function public.get_shared_photos(uuid, text) from anon;
revoke all on function public.get_shared_photos(uuid, text) from authenticated;
grant execute on function public.get_shared_photos(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- get_public_quote no longer carries photos: the signed-URL route is the one
-- source for them, so paths and links can never disagree.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_quote(token uuid) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quote_number', q.quote_number,
    'status', q.status,
    'title', q.title,
    'description', q.description,
    'quote_date', q.created_at::date,
    'valid_until', q.valid_until,
    'customer_name', c.name,
    'vehicle_label', coalesce(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
    'labor_hours', q.labor_hours,
    'labor_rate_cents', q.labor_rate_cents,
    'tax_rate_bp', q.tax_rate_bp,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'description', l.description, 'qty', l.qty,
        'unit_charge_cents', l.unit_charge_cents, 'line_total_cents', l.line_total_cents,
        'declined', l.declined
      ) order by l.created_at), '[]'::jsonb)
      from public.quote_lines l where l.quote_id = q.id
    ),
    'deposit_kind', q.deposit_kind,
    'deposit_value', q.deposit_value,
    'deposit_cents', case
      when q.status = 'approved' then coalesce(q.deposit_cents, (q.approved_snapshot->>'deposit_cents')::integer)
      else quote_deposit_cents(q.id)
    end,
    'deposit_outstanding_cents', case
      when q.status = 'approved' then quote_deposit_outstanding_cents(q.id) else 0 end,
    'deposit_payable', (q.vehicle_id is not null or q.job_id is not null),
    'approved_at', q.decided_at,
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email
      ) from public.settings s limit 1
    )
  )
  from public.quotes q
  join public.customers c on c.id = q.customer_id
  left join public.vehicles v on v.id = q.vehicle_id
  where q.public_token = token and q.deleted_at is null
$$;
