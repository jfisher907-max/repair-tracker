-- The authorization record becomes append-only.
--
-- 0003 stored the approval on the quote itself, which has two holes. Editing a
-- quote resets it to draft but left the old name, consent and snapshot behind,
-- so the record card could describe a document the customer never saw — and a
-- decline could be relabelled as an approval. And a quote that is re-sent and
-- answered a second time overwrote the first response with no trace.
--
-- A response is an event. Events get appended, never edited.

create table if not exists public.quote_approvals (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  response    text not null check (response in ('approved', 'declined')),
  by_name     text,
  consent     boolean,
  ip          text,
  user_agent  text,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists quote_approvals_quote_idx on public.quote_approvals (quote_id, created_at);

alter table public.quote_approvals enable row level security;

drop policy if exists owner_all on public.quote_approvals;
create policy owner_all on public.quote_approvals for all using (is_owner()) with check (is_owner());

-- Carry across the single response 0003 recorded, so nothing already captured
-- is lost when the quote-level columns start being cleared on edit.
insert into public.quote_approvals (quote_id, response, by_name, consent, ip, user_agent, snapshot, created_at)
select q.id,
       case when q.status = 'declined' then 'declined' else 'approved' end,
       q.approved_by_name, q.approval_consent, q.approval_ip, q.approval_user_agent,
       q.approved_snapshot, coalesce(q.decided_at, q.updated_at, now())
  from public.quotes q
 where q.approved_snapshot is not null
   and not exists (select 1 from public.quote_approvals a where a.quote_id = q.id);

create or replace function public.respond_public_quote(
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

  -- The permanent record: one row per response, never updated.
  insert into quote_approvals (quote_id, response, by_name, consent, ip, user_agent, snapshot)
  values (v_quote.id, response,
          nullif(btrim(coalesce(p_name, '')), ''),
          p_consent, p_ip, left(coalesce(p_user_agent, ''), 400), v_snapshot);

  -- The quote's own columns are a convenience copy of the latest response and
  -- are cleared when the quote is edited back to draft.
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
