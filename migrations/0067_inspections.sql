-- 0067: pre-purchase inspections (automotive), attachable to an invoice and
-- shareable by their own link.
--
-- Owner, 2026-10-05: "Lets go with a quick check for now with options to
-- adjust things as necessary." One package today ('quick'); its checklist
-- lives in code (lib/inspection-templates.ts) and is COPIED into
-- inspection_items when an inspection starts, so editing the template later
-- never changes a report already made. "Adjust as necessary": items can be
-- added, skipped (Not checked / N/A) or removed (custom ones) while a draft.
--
-- One inspection belongs to one job (the paid work: the job's labor is the
-- inspection fee, so it reaches the invoice like any other labor). A final
-- report is frozen; a change means void and start again, the rule issued
-- invoices follow. (0066 is reserved for SEC-1.)

create sequence if not exists public.inspection_number_seq;

create table if not exists public.inspections (
  id               uuid primary key default gen_random_uuid(),
  report_number    text not null default ('R' || lpad(nextval('public.inspection_number_seq')::text, 3, '0')),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  package          text not null default 'quick',
  status           text not null default 'draft',
  prepared_for     text,
  seller_name      text,
  odometer_miles   integer,
  inspected_on     date not null default public.shop_today(),
  road_test_done   boolean,
  road_test_reason text,
  recalls_note     text,
  verdict          text,
  summary_note     text,
  show_costs       boolean not null default true,
  -- Frozen at finalize: the vehicle as it was described on the report.
  vehicle_snapshot jsonb,
  signed_by_name   text,
  finalized_at     timestamptz,
  public_token     uuid not null default gen_random_uuid() unique,
  link_revoked_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint inspections_package_check check (package = any (array['quick'::text])),
  constraint inspections_status_check check (status = any (array['draft'::text, 'final'::text, 'void'::text])),
  constraint inspections_verdict_check
    check (verdict is null or verdict = any (array['no_major'::text, 'repairs'::text, 'major'::text])),
  constraint inspections_odometer_check check (odometer_miles is null or odometer_miles >= 0),
  constraint inspections_final_complete_check
    check (status <> 'final' or (verdict is not null and finalized_at is not null and vehicle_snapshot is not null))
);
comment on table public.inspections is
  'Pre-purchase inspection reports (automotive). Checklist copied from lib/inspection-templates.ts at start; frozen once final; shared by public_token through get_public_inspection. 0067.';
create index if not exists inspections_job_idx on public.inspections (job_id);

create table if not exists public.inspection_items (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.inspections(id) on delete cascade,
  section         text not null,
  position        integer not null,
  label           text not null,
  -- What the item takes: a lift, a scan tool, a road test (shown to the owner only).
  needs           text,
  -- Which measurement fields the item shows: 'tread' (32nds per tire),
  -- 'battery' (rated vs measured CCA), or null.
  measure_kind    text,
  rating          text,
  note            text,
  measure         jsonb,
  cost_low_cents  integer,
  cost_high_cents integer,
  custom          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inspection_items_rating_check
    check (rating is null or rating = any (array['ok'::text, 'watch'::text, 'attention'::text, 'not_checked'::text, 'na'::text])),
  constraint inspection_items_measure_kind_check
    check (measure_kind is null or measure_kind = any (array['tread'::text, 'battery'::text])),
  constraint inspection_items_cost_check
    check ((cost_low_cents is null or cost_low_cents >= 0)
       and (cost_high_cents is null or cost_high_cents >= 0)
       and (cost_low_cents is null or cost_high_cents is null or cost_high_cents >= cost_low_cents))
);
create index if not exists inspection_items_inspection_idx on public.inspection_items (inspection_id, position);

drop trigger if exists inspections_updated_at on public.inspections;
create trigger inspections_updated_at before update on public.inspections
  for each row execute function public.set_updated_at();
drop trigger if exists inspection_items_updated_at on public.inspection_items;
create trigger inspection_items_updated_at before update on public.inspection_items
  for each row execute function public.set_updated_at();

-- A final report never changes. Allowed after final: void it, and turn its
-- link off, back on, or replace it (link_revoked_at / public_token).
create or replace function public.inspections_frozen() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('final', 'void') then
    if old.status = 'void' and new.status <> 'void' then
      raise exception 'inspection_frozen' using detail = 'This report was voided. Start a new one.';
    end if;
    if (to_jsonb(new) - array['status', 'link_revoked_at', 'public_token', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'link_revoked_at', 'public_token', 'updated_at'])
       or (old.status = 'final' and new.status not in ('final', 'void')) then
      raise exception 'inspection_frozen' using detail = 'This report is final. Void it and start a new one.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists inspections_frozen on public.inspections;
create trigger inspections_frozen before update on public.inspections
  for each row execute function public.inspections_frozen();

create or replace function public.inspection_items_frozen() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.inspections
   where id = coalesce(new.inspection_id, old.inspection_id);
  if v_status in ('final', 'void') then
    raise exception 'inspection_frozen' using detail = 'This report is final. Void it and start a new one.';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists inspection_items_frozen on public.inspection_items;
create trigger inspection_items_frozen before insert or update or delete on public.inspection_items
  for each row execute function public.inspection_items_frozen();

-- Owner only; logged-out visitors hold nothing (house lines, 0054).
alter table public.inspections enable row level security;
alter table public.inspection_items enable row level security;
drop policy if exists owner_all on public.inspections;
create policy owner_all on public.inspections
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.inspection_items;
create policy owner_all on public.inspection_items
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.inspections from public, anon;
revoke all on public.inspection_items from public, anon;
revoke all on sequence public.inspection_number_seq from public, anon;
grant select, insert, update, delete on public.inspections, public.inspection_items to authenticated, service_role;
grant usage, select on sequence public.inspection_number_seq to authenticated, service_role;
revoke all on function public.inspections_frozen() from public, anon;
revoke all on function public.inspection_items_frozen() from public, anon;
grant execute on function public.inspections_frozen(), public.inspection_items_frozen() to authenticated, service_role;

-- The customer's report, by its link: final and not turned off, or nothing.
-- N/A items are left off; cost ranges only when the owner chose to show them.
create or replace function public.get_public_inspection(token uuid)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'report_number', i.report_number,
    'package', i.package,
    'prepared_for', i.prepared_for,
    'seller_name', i.seller_name,
    'odometer_miles', i.odometer_miles,
    'inspected_on', i.inspected_on,
    'road_test_done', i.road_test_done,
    'road_test_reason', i.road_test_reason,
    'recalls_note', i.recalls_note,
    'verdict', i.verdict,
    'summary_note', i.summary_note,
    'show_costs', i.show_costs,
    'vehicle', i.vehicle_snapshot,
    'signed_by_name', i.signed_by_name,
    'finalized_at', i.finalized_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', it.section, 'label', it.label, 'rating', it.rating, 'note', it.note,
        'measure_kind', it.measure_kind, 'measure', it.measure,
        'cost_low_cents', case when i.show_costs then it.cost_low_cents end,
        'cost_high_cents', case when i.show_costs then it.cost_high_cents end
      ) order by it.position)
      from public.inspection_items it
      where it.inspection_id = i.id and it.rating is distinct from 'na'
    ), '[]'::jsonb),
    'business', (
      select jsonb_build_object(
        'name', s.business_name, 'phone', s.business_phone,
        'address', s.business_address, 'email', s.business_email
      ) from public.settings s limit 1
    )
  )
  from public.inspections i
  where i.public_token = token and i.status = 'final' and i.link_revoked_at is null
$$;
revoke all on function public.get_public_inspection(uuid) from public;
grant execute on function public.get_public_inspection(uuid) to anon, authenticated, service_role;

-- The report link an invoice carries: the newest final, shared report on the
-- invoice's job. Looked up live, so turning the report's link off also takes
-- it off the invoice. Returns only the report's token.
create or replace function public.get_invoice_inspection_token(token uuid)
returns uuid
language sql
stable security definer
set search_path = public
as $$
  select ins.public_token
    from public.invoices inv
    join public.inspections ins on ins.job_id = inv.job_id
   where inv.public_token = token and inv.status <> 'void'
     and ins.status = 'final' and ins.link_revoked_at is null
   order by ins.finalized_at desc
   limit 1
$$;
revoke all on function public.get_invoice_inspection_token(uuid) from public;
grant execute on function public.get_invoice_inspection_token(uuid) to anon, authenticated, service_role;

-- PROOF (after applying; read-only):
--   select has_table_privilege('anon','public.inspections','SELECT,INSERT,UPDATE,DELETE'),
--          has_table_privilege('anon','public.inspection_items','SELECT,INSERT,UPDATE,DELETE');  -- f, f
--   select public.get_public_inspection(gen_random_uuid());                                      -- null
-- UNDO:
--   drop function if exists public.get_invoice_inspection_token(uuid), public.get_public_inspection(uuid);
--   drop table if exists public.inspection_items, public.inspections;
--   drop function if exists public.inspections_frozen(), public.inspection_items_frozen();
--   drop sequence if exists public.inspection_number_seq;
