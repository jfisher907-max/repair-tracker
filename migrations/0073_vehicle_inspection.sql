-- 0073: a second inspection package, the Vehicle Inspection.
--
-- Owner, 2026-11-27: "I need you to build an inspection sheet for Airlift
-- Northwest. I want a sheet that has general items for fluid levels, leaks,
-- conditions, etc. but I specifically want to make sure it has brake pad
-- life, tire life and a chart to locate and acknowledge body damage." And:
-- "a diagram that adds a visual representation of the type of car that's
-- being inspected and allows me to highlight any body damage found."
--
-- 0067 built inspections with one package ('quick', the pre-buy) and two
-- measures ('tread', 'battery'). The Vehicle Inspection is package 'fleet'
-- with two more measures, both kept in inspection_items.measure (jsonb) as
-- tread already is:
--   'pads'   brake pad left at each wheel, in mm: {lf, rf, lr, rr}
--   'damage' the body damage chart: {chart, marks:[{id,x,y,kind,where,note}],
--            none, ack_name, ack_at}
--
-- So this migration only WIDENS two CHECK constraints. Nothing else moves:
--   - no new table or column, no data rewritten, no existing row touched
--     (every existing row is 'quick' with a null, 'tread' or 'battery' measure,
--     all still allowed);
--   - get_public_inspection is NOT changed. It already returns each report's
--     package and each item's measure_kind and measure, which is everything
--     the new report prints. The public surface returns no new field.
--   - the frozen-report triggers compare whole rows, so a final Vehicle
--     Inspection is frozen exactly as a final pre-buy is, marks and
--     acknowledgement included.
--
-- What reaches the customer through the existing function, on purpose: the
-- marks (place, kind, the shop's note on each) and the name of the customer's
-- own person who acknowledged the chart, with when. Nothing about cost or
-- profit lives in a measure.
--
-- Deploy order: this first, then the code. Before it, starting a Vehicle
-- Inspection is refused by the old check and the app says the update is not
-- applied yet; pre-buy reports work either way.

alter table public.inspections drop constraint if exists inspections_package_check;
alter table public.inspections add constraint inspections_package_check
  check (package = any (array['quick'::text, 'fleet'::text]));

alter table public.inspection_items drop constraint if exists inspection_items_measure_kind_check;
alter table public.inspection_items add constraint inspection_items_measure_kind_check
  check (measure_kind is null
      or measure_kind = any (array['tread'::text, 'battery'::text, 'pads'::text, 'damage'::text]));

comment on table public.inspections is
  'Inspection reports (automotive): the pre-purchase Quick Check (package quick, 0067) and the Vehicle Inspection (package fleet, 0073). Checklist copied from lib/inspection-templates.ts at start; frozen once final; shared by public_token through get_public_inspection.';

-- The end state, asserted here so a silent no-op cannot pass (the package
-- column is NOT NULL, so its check cannot pass on a null).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'inspections_package_check'
       and conrelid = 'public.inspections'::regclass
       and pg_get_constraintdef(oid) like '%fleet%'
  ) then
    raise exception '0073: inspections_package_check does not allow fleet';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'inspection_items_measure_kind_check'
       and conrelid = 'public.inspection_items'::regclass
       and pg_get_constraintdef(oid) like '%damage%'
       and pg_get_constraintdef(oid) like '%pads%'
  ) then
    raise exception '0073: inspection_items_measure_kind_check does not allow pads and damage';
  end if;
end $$;

-- PROOF (after applying; read-only):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('inspections_package_check', 'inspection_items_measure_kind_check');
--   -- both list the new words
--   select count(*) from public.inspections where package not in ('quick', 'fleet');  -- 0
-- UNDO (only while no fleet report exists; otherwise the old check cannot be put back):
--   alter table public.inspections drop constraint inspections_package_check;
--   alter table public.inspections add constraint inspections_package_check
--     check (package = any (array['quick'::text]));
--   alter table public.inspection_items drop constraint inspection_items_measure_kind_check;
--   alter table public.inspection_items add constraint inspection_items_measure_kind_check
--     check (measure_kind is null or measure_kind = any (array['tread'::text, 'battery'::text]));
