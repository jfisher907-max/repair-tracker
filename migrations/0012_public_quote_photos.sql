-- Customer-visible job photos on the public quote page (/q), part 1 of 2.
--
-- Photo-backed approval requests are the single biggest conversion lever the
-- big systems have (Bolt On reports big-ticket approval roughly doubling).
-- The photos already exist (job_photos, customer_visible flag); this exposes
-- the flagged ones' storage paths through the token-gated quote RPC.
--
-- Part 2 (run separately by the owner - it widens anon's storage access) is
-- an RLS policy letting anon create signed URLs for exactly these objects:
--
--   create policy receipts_customer_visible_photos on storage.objects
--     for select to anon
--     using (
--       bucket_id = 'receipts'
--       and exists (
--         select 1 from public.job_photos p
--         where p.storage_path = name and p.customer_visible
--       )
--     );
--
-- Security model: paths are unguessable uuids that only leave the database
-- through this token-gated RPC; the policy re-checks customer_visible at
-- request time, so unflagging a photo revokes it immediately. Until part 2
-- runs, the /q page simply shows no photos (signing fails, section hidden).

create or replace function public.get_public_quote(token uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', p.storage_path, 'caption', p.caption
      ) order by p.created_at), '[]'::jsonb)
      from public.job_photos p
      where p.job_id = q.job_id and p.customer_visible
    ),
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
$function$;
