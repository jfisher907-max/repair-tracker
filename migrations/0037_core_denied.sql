-- 0037: a core deposit can be DENIED, not just returned.
--
-- Until now a core had two states: outstanding (core_returned_at null) or
-- returned. Reality has a third - the supplier refuses the old unit (cracked
-- housing, wrong part, customer kept it), and the deposit is money that is
-- never coming back. That is the ONLY case where a core belongs on the
-- customer's bill; a core that goes back is the shop's own deposit and the
-- customer never pays it (owner's rule, 2026-09-11).
--
-- The three states are derived, not stored twice:
--   outstanding : core_returned_at is null and core_denied_at is null
--   returned    : core_returned_at is not null   -- the refund books the money
--   denied      : core_denied_at is not null     -- gone for good
--
-- And a denied core has two outcomes, already expressible on the line itself:
--   billed   : on_invoice = true,  unit_charge_cents = unit_cost_cents (face
--              value - a core is pass-through and is never marked up)
--   absorbed : on_invoice = false, charge exactly 0 (the shop eats it)

alter table public.part_lines
  add column if not exists core_denied_at timestamptz;

comment on column public.part_lines.core_denied_at is
  'When the supplier refused this core deposit. Set = the money is gone; bill it or absorb it.';

-- A core cannot have come back AND been refused.
alter table public.part_lines
  drop constraint if exists part_lines_core_state_exclusive;
alter table public.part_lines
  add constraint part_lines_core_state_exclusive
  check (core_returned_at is null or core_denied_at is null);
