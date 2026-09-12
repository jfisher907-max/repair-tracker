-- 0039: drop the constraint 0037 got wrong.
--
-- 0037 added:
--   check (core_returned_at is null or core_denied_at is null)
-- on the reasoning that a core cannot both come back and be refused. That is
-- backwards. The ordinary way a core is denied is:
--
--   hand the old unit across the counter   -> core_returned_at set
--   the store refuses it (cracked, wrong)  -> core_denied_at set
--
-- so the two are set together on exactly the case this feature exists for, and
-- the CHECK would have refused the write. The state is read in priority order
-- (denied, then credited, then returned), so nothing needs the exclusion.
--
-- What IS genuinely exclusive is credited vs denied - the deposit cannot both
-- have come back and be gone - and 0038 already constrains that.

alter table public.part_lines
  drop constraint if exists part_lines_core_state_exclusive;
