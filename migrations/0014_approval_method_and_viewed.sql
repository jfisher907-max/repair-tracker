-- Two authorization-trail upgrades from the competitor research.
--
-- 1. HOW consent arrived. State rules for verbal add-on approvals (CA BPC
--    9884.9 is the strictest) require date, time, the person who authorized,
--    and the channel used. The online flow already records everything; this
--    adds a method column so owner-recorded approvals (phone call, in person,
--    text thread) carry the same structure. Existing rows were all online.
alter table public.quote_approvals
  add column if not exists method text not null default 'online';

-- 2. WHETHER the customer ever saw it. Stamped on first open of the public
--    quote link; "sent 3 days ago, never viewed" and "viewed an hour after
--    sending, no answer" are different follow-up calls.
alter table public.quotes add column if not exists viewed_at timestamptz;

-- Fire-and-forget from the /q page. A separate volatile function (rather
-- than stamping inside get_public_quote) keeps the read RPC a pure read.
-- First view wins; later opens don't move the timestamp.
create or replace function public.mark_quote_viewed(token uuid)
returns void
language sql
volatile security definer
set search_path to 'public'
as $$
  update quotes set viewed_at = coalesce(viewed_at, now())
  where public_token = token and deleted_at is null;
$$;
