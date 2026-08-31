-- Fold the standalone Hangar Tracker into this app as a Hangar section.
--
-- The tracker (Wings Hangar vs ALNW usage for two Learjets at PAJN, plus Wings
-- unavailability periods for prorating hangar management billed to Airlift
-- Northwest) lived in its own free-tier Supabase project. That project and this
-- one have been trading the org's two active-project slots — whichever app was
-- idle got auto-paused, and its UI failed in confusing ways (the old PIN screen
-- reported "Incorrect PIN" when the DB was simply unreachable). One app, one DB
-- ends that. Data is imported from the old project as-is, original ids and
-- timestamps preserved.
--
-- Access model changes on purpose: the standalone app was open to anyone with
-- the URL (legacy of its whiteboard-replacement origins). Inside this app the
-- hangar pages sit behind the owner login like everything else, so these tables
-- take the standard owner_all / is_owner() policy and NO anon access.
--
-- Times are timestamptz; a NULL exit/end_time means "still there" / "still
-- unavailable" and the app counts the open span with now() as a provisional end.
-- No money columns: hangar metrics are deliberately time-only (hours), the
-- dollar proration was removed from the tracker at the owner's request.

create table if not exists public.hangar_sessions (
  id uuid primary key default gen_random_uuid(),
  aircraft text not null,
  hangar text not null,
  entry timestamptz not null,
  exit timestamptz,
  reason text not null default '',
  note text not null default '',
  exit_reason text not null default '',
  exit_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists hangar_sessions_entry_idx
  on public.hangar_sessions (entry desc);

create table if not exists public.hangar_unavailability (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists hangar_unavailability_start_idx
  on public.hangar_unavailability (start_time desc);

alter table public.hangar_sessions enable row level security;
alter table public.hangar_unavailability enable row level security;

drop policy if exists owner_all on public.hangar_sessions;
create policy owner_all on public.hangar_sessions
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists owner_all on public.hangar_unavailability;
create policy owner_all on public.hangar_unavailability
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

comment on table public.hangar_sessions is
  'One aircraft''s stay in a hangar (Wings Hangar or ALNW). NULL exit = currently in the hangar. Imported history from the retired standalone Hangar Tracker keeps its original ids.';
comment on table public.hangar_unavailability is
  'Periods when Wings Hangar was unusable (owner needed the space, etc). NULL end_time = still unavailable. The monthly unavailable-hours total is the evidence behind ALNW hangar-management billing.';
