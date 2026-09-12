-- 0038: handing a core back is not the same as the store ACCEPTING it.
--
-- 0037 added "denied". This adds the step before it. A core deposit goes:
--
--   out             deposit paid, old unit still on the shelf here
--                     -> take it back to the store
--   awaiting credit  handed back, nobody has confirmed the money came back
--                     -> verify the credit actually landed
--   credited         confirmed: the deposit is back. Done.
--   denied           the store refused it. The money is gone for good, so the
--                    line is either billed to the job or absorbed (0037).
--
-- The middle state is the whole point of this migration: a core handed over
-- the counter and quietly rejected used to read as "returned" and disappear
-- off the worklist, and the deposit was never seen again.
--
--   out             = returned_at null, credited_at null, denied_at null
--   awaiting credit = returned_at set,  credited_at null, denied_at null
--   credited        = credited_at set
--   denied          = denied_at set

alter table public.part_lines
  add column if not exists core_credited_at timestamptz;

comment on column public.part_lines.core_credited_at is
  'When the deposit was confirmed back from the supplier (credit seen). Null while a handed-back core is still unverified.';

-- The two cores already marked returned (J002, 2026-08-18) are confirmed by
-- that job's own "Core Charge Return" credit line of -$90.00, so they are
-- credited rather than unverified - without this they would reappear as two
-- stale reminders about money that is demonstrably already back.
update public.part_lines
   set core_credited_at = core_returned_at
 where core_returned_at is not null
   and core_credited_at is null;

-- Credited and denied are mutually exclusive (returned vs denied is 0037's).
alter table public.part_lines
  drop constraint if exists part_lines_core_credit_exclusive;
alter table public.part_lines
  add constraint part_lines_core_credit_exclusive
  check (core_credited_at is null or core_denied_at is null);
