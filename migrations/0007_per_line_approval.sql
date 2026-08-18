-- Per-line approval: "do the brakes now, skip the flush" in one visit.
--
-- A quote was all-or-nothing — one Approve for the whole document. The common
-- real answer is partial, which forced a rebuild-and-resend from the phone.
-- Now each line can be declined by the customer; what remains is the approved
-- work, and the declined lines become recommendations when the quote converts
-- to a job, feeding the follow-up worklist instead of being lost.
--
-- Also: settings.google_review_url for the post-payment review request.

alter table public.quote_lines
  add column if not exists declined boolean not null default false;

comment on column public.quote_lines.declined is
  'Set by the customer''s response. Declined lines leave the total and become recommendations at conversion.';

alter table public.settings
  add column if not exists google_review_url text;

-- Approved-subset totals: declined lines no longer count.
create or replace view public.quote_totals
with (security_invoker = true) as
 SELECT q.id AS quote_id,
    round(q.labor_hours * q.labor_rate_cents::numeric)::integer AS labor_cents,
    COALESCE(sum(l.line_total_cents) filter (where not l.declined), 0::bigint)::integer AS lines_cents,
    round((round(q.labor_hours * q.labor_rate_cents::numeric) + COALESCE(sum(l.line_total_cents) filter (where not l.declined), 0::bigint)::numeric) * q.tax_rate_bp::numeric / 10000.0)::integer AS tax_cents,
    (round(q.labor_hours * q.labor_rate_cents::numeric) + COALESCE(sum(l.line_total_cents) filter (where not l.declined), 0::bigint)::numeric + round((round(q.labor_hours * q.labor_rate_cents::numeric) + COALESCE(sum(l.line_total_cents) filter (where not l.declined), 0::bigint)::numeric) * q.tax_rate_bp::numeric / 10000.0))::integer AS total_cents
   FROM quotes q
     LEFT JOIN quote_lines l ON l.quote_id = q.id
  GROUP BY q.id;

-- The public payload gains line ids (needed to name what was declined) and the
-- declined flag (needed to render the result). Ids are inert without the token.
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

-- Accepts the declined line ids. Each response is a complete statement, so the
-- flags are overwritten across all the quote's lines, not merged.
drop function if exists public.respond_public_quote(uuid, text, text, boolean, text, text);

create function public.respond_public_quote(
  token           uuid,
  response        text,
  p_name          text    default null,
  p_consent       boolean default null,
  p_ip            text    default null,
  p_user_agent    text    default null,
  p_declined_ids  uuid[]  default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote    record;
  v_declined uuid[];
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

  -- Only ids that actually belong to this quote count; anything else is
  -- silently dropped rather than trusted.
  select coalesce(array_agg(l.id), '{}') into v_declined
    from quote_lines l
   where l.quote_id = v_quote.id
     and l.id = any(coalesce(p_declined_ids, '{}'));

  if response = 'approved' then
    -- Declining every line on a labor-free quote would approve $0 of work.
    if round(coalesce(v_quote.labor_hours, 0) * coalesce(v_quote.labor_rate_cents, 0)) = 0
       and not exists (
         select 1 from quote_lines l
          where l.quote_id = v_quote.id and not (l.id = any(v_declined))
       ) then
      return null;
    end if;

    update quote_lines l
       set declined = (l.id = any(v_declined))
     where l.quote_id = v_quote.id;
  end if;

  v_labor := round(coalesce(v_quote.labor_hours, 0) * coalesce(v_quote.labor_rate_cents, 0));
  select coalesce(sum(line_total_cents), 0) into v_parts
    from quote_lines where quote_id = v_quote.id and not declined;
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
               'line_total_cents',  l.line_total_cents,
               'declined',          l.declined)
             order by l.created_at)
        from quote_lines l where l.quote_id = v_quote.id), '[]'::jsonb),
    'response',   response,
    'by_name',    p_name,
    'frozen_at',  now()
  );

  insert into quote_approvals (quote_id, response, by_name, consent, ip, user_agent, snapshot)
  values (v_quote.id, response,
          nullif(btrim(coalesce(p_name, '')), ''),
          p_consent, p_ip, left(coalesce(p_user_agent, ''), 400), v_snapshot);

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

revoke all on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) from public;
grant execute on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) to anon, authenticated;
