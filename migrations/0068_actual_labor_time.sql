-- 0068: actual time on a job, beside the book time it is billed at.
--
-- Owner, 2026-11-05: "I'd like to have a way to track actual hours spent on a
-- job to see how I'm doing performance-wise compared to book labor time."
--
-- jobs.labor_hours stays what it has always been: the hours BILLED, which is
-- the book time. These two columns are the clock Jake keeps on himself:
--   actual_hours     - logged hours so far (typed, nudged, or from the clock).
--                      NULL = not tracked on this job, so it stays out of the
--                      efficiency figures instead of reading as 0 hours.
--   clock_started_at - set while the job clock is running; Stop adds the time
--                      since then to actual_hours and clears it.
-- Efficiency = book / actual (lib/labor-time.ts). Neither column touches money:
-- no total, view, invoice snapshot or quote reads them.
--
-- SECURITY: owner-only, like notes. No public RPC (get_public_quote,
-- get_public_invoice) returns them and the customer report never prints them.
-- No new table, so no new policy; the columns sit under jobs' owner_all
-- (is_owner()) policy. anon holds nothing on jobs (0054); the revoke restates it.

alter table public.jobs
  add column if not exists actual_hours numeric(7,2),
  add column if not exists clock_started_at timestamptz;

alter table public.jobs drop constraint if exists jobs_actual_hours_check;
alter table public.jobs add constraint jobs_actual_hours_check
  check (actual_hours is null or actual_hours >= 0);

comment on column public.jobs.actual_hours is
  'Hours actually spent on the job (owner only). NULL = not tracked. Compared with labor_hours (book) for efficiency. 0068.';
comment on column public.jobs.clock_started_at is
  'When the job clock was started; NULL = not running. Stopping adds the elapsed time to actual_hours. 0068.';

-- House lines (0054): logged-out visitors hold nothing on the new columns.
revoke all (actual_hours, clock_started_at) on public.jobs from public, anon;

-- PROOF (read-only):
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'jobs'
--      and column_name in ('actual_hours', 'clock_started_at');          -- 2 rows
--   select has_column_privilege('anon', 'public.jobs', 'actual_hours', 'SELECT,UPDATE'); -- false
--   select count(*) from jobs where actual_hours is not null;           -- 0
--
-- UNDO (loses every logged hour):
--   alter table public.jobs drop constraint if exists jobs_actual_hours_check,
--     drop column if exists actual_hours, drop column if exists clock_started_at;
