-- Recommendations become trackable items rather than a paragraph.
--
-- A recommendation is only worth capturing if something later brings it back.
-- Free text on the job could be read but never worked: no status, no due date,
-- no way to see every open item across all vehicles. This gives each one a
-- lifecycle and a home the worklist can query.
--
-- The existing text migrates as ONE row per job, verbatim. Splitting on commas
-- would mangle a sentence like "…within about 6 months. Serpentine belt showing
-- early cracking, watch at next oil change." — the owner can split them by hand
-- where he actually meant several items.

create table if not exists public.recommendations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  -- Denormalised so the worklist can group by vehicle without walking jobs,
  -- and so a recommendation survives in history independently of its job.
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  description     text not null,
  status          text not null default 'open'
                    check (status in ('open', 'booked', 'done', 'declined')),
  target_date     date,
  estimate_cents  integer,
  -- Which job eventually did the work, when one does.
  resolved_job_id uuid references public.jobs(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists recommendations_vehicle_idx on public.recommendations (vehicle_id);
create index if not exists recommendations_job_idx     on public.recommendations (job_id);
create index if not exists recommendations_open_idx    on public.recommendations (status, created_at);

alter table public.recommendations enable row level security;

drop policy if exists owner_all on public.recommendations;
create policy owner_all on public.recommendations for all using (is_owner()) with check (is_owner());

drop trigger if exists recommendations_updated_at on public.recommendations;
create trigger recommendations_updated_at
  before update on public.recommendations
  for each row execute function set_updated_at();

-- Carry the existing notes over, once.
insert into public.recommendations (job_id, vehicle_id, description, created_at)
select j.id, j.vehicle_id, btrim(j.recommendations), j.created_at
  from public.jobs j
 where j.recommendations is not null
   and btrim(j.recommendations) <> ''
   and not exists (select 1 from public.recommendations r where r.job_id = j.id);

-- jobs.recommendations is left in place but is no longer read or written by the
-- app; it stays as a safety net until the new table has been in use a while.
comment on column public.jobs.recommendations is
  'SUPERSEDED by the recommendations table. Retained as a migration safety net; nothing reads it.';
