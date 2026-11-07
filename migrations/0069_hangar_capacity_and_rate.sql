-- Hangar: enforce the physical rules, and give the ALNW rate a real home.
--
-- Two separate problems, one migration because the second depends on the first
-- being trustworthy.
--
-- 1. THE PHYSICAL RULES WERE ONLY HOPED FOR.
--    The board's one-tap move closes a jet's open session before opening the
--    next, so that path is safe. "Log past move" has no such guard, and it
--    shows: there is exactly one overlapping pair in the data, 48 seconds of
--    N254AL being in ALNW and Wings Hangar at once on 2026-09-19 (an ALNW
--    session closed at 18:10:48.205 by the board, against a past-move logged
--    as starting 18:10:00). Harmless at 0.0 hours, but the same seam could
--    silently inflate the hours ALNW is billed against.
--
--    Jake's capacity rule, stated 2026-11-07: ALNW holds TWO aircraft, Wings
--    Hangar holds ONE. Checked against every session on record — Wings has
--    never held two, and every concurrent pair is in ALNW where two is legal
--    (seven stretches, longest 726.8 hours, Oct 4 to Nov 4).
--
--    tstzrange's default bounds are [) — inclusive start, exclusive end — so a
--    session that ends exactly when the next begins does NOT overlap, which is
--    what a move is. A NULL exit gives an unbounded upper bound, so an open
--    session is correctly treated as "still there" rather than skipped (a CHECK
--    constraint over a nullable column would simply pass instead).
--
--    ALNW's capacity of two cannot be written as an exclusion constraint, which
--    can only say "no two overlapping", i.e. a capacity of one. It also cannot
--    currently be exceeded: the fleet is two aircraft and the other constraint
--    stops one of them being in two places. If a third aircraft is ever tracked,
--    ALNW needs a trigger — there is no constraint that expresses "at most 2".
--
-- 2. THE RATE LIVED IN A BROWSER.
--    0029 said "No money columns: hangar metrics are deliberately time-only,
--    the dollar proration was removed at the owner's request." The proration
--    came back anyway, as a display-only tile on the Reports page reading a
--    monthly rate out of localStorage ('wnt_hangar_rate') with a hard-coded
--    $12,000 fallback. So the money is already here; it is just kept in the
--    worst available place — per-browser, lost when site data is cleared,
--    silently reverting to a number nobody chose, with no record of which rate
--    applied to which month, and unreachable by anything server-side.
--
--    This table does not add money to the metrics. The hours stay time-only.
--    It gives the rate that is already being applied somewhere durable, in
--    integer cents like every other amount in this app, dated so that changing
--    it next year does not silently re-price last year.
--
--    Deliberately NOT seeded: the real rate is in Jake's browser and guessing
--    it would invent a financial figure. The Reports page asks for it once.

-- ── 1. Physical rules ────────────────────────────────────────────────

create extension if not exists btree_gist with schema extensions;

-- The 48-second overlap described above. Closing ALNW at the moment the Wings
-- session opens is what the board would have recorded had the move been logged
-- live. Previous value: 2026-09-19 18:10:48.205+00.
update public.hangar_sessions
   set exit = '2026-09-19 18:10:00+00'
 where id = '452d7427-ec17-4db7-9c5b-e8e00e8f5423'
   and exit = '2026-09-19 18:10:48.205+00';

alter table public.hangar_sessions
  drop constraint if exists hangar_sessions_one_place_at_a_time;
alter table public.hangar_sessions
  add constraint hangar_sessions_one_place_at_a_time
  exclude using gist (
    aircraft with =,
    tstzrange(entry, exit) with &&
  );

alter table public.hangar_sessions
  drop constraint if exists hangar_sessions_wings_holds_one;
alter table public.hangar_sessions
  add constraint hangar_sessions_wings_holds_one
  exclude using gist (
    hangar with =,
    tstzrange(entry, exit) with &&
  ) where (hangar = 'Wings Hangar');

comment on constraint hangar_sessions_one_place_at_a_time on public.hangar_sessions is
  'An aircraft cannot be in two hangars at once. Overlap is half-open, so a move (exit == next entry) is fine.';
comment on constraint hangar_sessions_wings_holds_one on public.hangar_sessions is
  'Wings Hangar physically holds one aircraft. ALNW holds two, which no constraint can express and which the two-aircraft fleet cannot exceed anyway.';

-- ── 2. The ALNW monthly rate, in cents, with history ─────────────────

create table if not exists public.hangar_rates (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  monthly_rate_cents integer not null check (monthly_rate_cents >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists hangar_rates_effective_idx
  on public.hangar_rates (effective_from desc);

alter table public.hangar_rates enable row level security;

drop policy if exists owner_all on public.hangar_rates;
create policy owner_all on public.hangar_rates
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

comment on table public.hangar_rates is
  'What Airlift Northwest is charged per month for hangar management, in integer cents, from effective_from until the next row supersedes it. A month is priced with the row in force during that month, so changing the rate never re-prices a month already reported.';
comment on column public.hangar_rates.effective_from is
  'First day this rate applies. One row per change; the newest row on or before a month start prices that month.';
