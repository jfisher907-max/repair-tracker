-- 0036: an applied quote's PRICE is frozen; its supplier columns are not.
--
-- 0032 froze quote_lines outright once a quote is applied to a job, which is
-- right for everything the customer agreed to. But 0034 then added the columns
-- a receipt pairs against - part_number, line_code, unit_cost_cents,
-- unit_list_cents, unit_retail_cents, price_basis - and every live quoted job
-- (Q001, Q003, Q004, Q008) was already applied, so those columns can never be
-- filled in for any of them. Pairing on those jobs is permanently manual, and
-- typing the part number that would fix it fails with "this quote's lines are
-- already on a job".
--
-- This narrows the freeze to what it is actually protecting: the quote's
-- customer-facing shape (wording, quantity, price, declined). An UPDATE that
-- leaves all of those untouched is allowed; INSERT and DELETE stay refused, and
-- any change to a priced field stays refused.
--
-- Everything compares with `is not distinct from` so a NULL on either side
-- behaves, rather than making the whole predicate NULL and falling through to
-- the raise.

create or replace function public.quote_lines_frozen_once_applied()
returns trigger
language plpgsql
as $function$
declare
  v_applied timestamptz;
begin
  select applied_at into v_applied
    from public.quotes
   where id = case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;

  if v_applied is not null then
    if tg_op = 'UPDATE'
       and new.quote_id is not distinct from old.quote_id
       and new.description is not distinct from old.description
       and new.qty is not distinct from old.qty
       and new.unit_charge_cents is not distinct from old.unit_charge_cents
       and new.declined is not distinct from old.declined
    then
      -- Owner-only columns only: what the customer approved is untouched.
      return new;
    end if;
    raise exception 'this quote''s lines are already on a job - change the job instead';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

-- After applying, both of these should hold:
--   -- allowed (owner-only column on an applied quote):
--   update public.quote_lines set part_number = '19B2682B'
--    where id = (select ql.id from public.quote_lines ql
--                  join public.quotes q on q.id = ql.quote_id
--                 where q.applied_at is not null limit 1);
--   -- still refused (a priced field on an applied quote):
--   update public.quote_lines set unit_charge_cents = unit_charge_cents + 1
--    where id = (same row);  -- expect: this quote's lines are already on a job
