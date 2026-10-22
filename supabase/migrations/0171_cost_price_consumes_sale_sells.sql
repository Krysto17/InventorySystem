-- 0171 - A cost-price run consumes material; a bulk sale sells it
--
-- The two were conflated. Approving a cost-price run marked its lots 'sold',
-- which is wrong twice over: material is almost never sold at cost price, and a
-- run has no buyer and no selling price - cost_price_runs records
-- total_cost_price and avg_cost_price_per_kg and nothing else. So "sold" was
-- being recorded by the one step that cannot know whether anything was sold,
-- let alone for what.
--
-- The split, in the business's own words: a cost-price run REMOVES MATERIAL
-- FROM STOCK, and a bulk sale MARKS IT SOLD.
--
--   cost-price run approved  ->  lots become 'consumed', weight leaves stock
--   bulk sale approved       ->  revenue recorded against a buyer and a price
--
-- Two consequences follow, and both are deliberate.
--
-- 1. A BULK SALE NO LONGER WRITES A STOCK MOVEMENT. It cannot: the stock
--    balance is the sum of movements per (site, material, grade), the run has
--    already taken the weight out, and a second 'out' for the same material
--    would be refused by _stock_movements_balance_check for insufficient
--    stock - so selling a batch you had just costed would have been impossible.
--    Approval of the sale is now purely the revenue event.
--
--    The cost of this: material sold WITHOUT being costed first no longer
--    reduces stock. That follows from costing being the step that empties the
--    yard, which is how the business described the flow. If material is ever
--    sold straight out of stock with no cost-price run, it needs a stock
--    adjustment, or this needs revisiting.
--
-- 2. HISTORY IS RELABELLED, but only where it can be proven. Lots currently
--    'sold' that are traceable to an approved cost-price run were consumed, and
--    are corrected. Lots that reached 'sold' by a GATE PASS genuinely left the
--    premises and stay 'sold'. Anything else is left exactly as it is: it
--    cannot be attributed, and financial records are not a place to guess. On
--    the database this was written against, that split 92 rows into 85/3/5.
--
-- Unpaid material needed no change: the cost-price module already offers any
-- lot with status 'available' and never looks at batch_paid, so a batch can
-- include material the supplier has not been paid for. That is why the
-- statement reports cash paid to suppliers separately from cost of sales.

-- 'consumed' joins the allowed states. 'sold' keeps its meaning for material
-- that actually went to a buyer, which is now the only thing that sets it.
alter table public.stock_lots drop constraint if exists stock_lots_status_check;
alter table public.stock_lots add constraint stock_lots_status_check
  check (status in ('available', 'consumed', 'sold', 'released'));

CREATE OR REPLACE FUNCTION public._cost_price_runs_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it  record;
  lot record;
  bucket record;
begin
  if NEW.approval_status = 'approved' and OLD.approval_status is distinct from 'approved' then
    -- Take every stock bucket this run will consume BEFORE the first lot lock.
    --
    -- The balance guard on stock_movements takes an advisory lock per
    -- (site, material, grade). Acquiring it mid-loop meant this function held
    -- bucket while reaching for the next lot, whereas a second approval held
    -- that lot while reaching for the bucket — a reproducible deadlock. Taking
    -- the buckets first makes the order globally bucket -> lot; since 0155 gate
    -- acknowledgement takes the same order, so no path can invert it.
    --
    -- A run is NOT one bucket: 15 of 32 production runs span two sites. They
    -- are therefore ordered, so two runs over the same pair cannot take them in
    -- opposite orders. `grade` is '' because the inserts below always write null.
    for bucket in
      select distinct l.site_id, l.material_type_id
        from public.cost_price_run_lots rl
        join public.stock_lots l on l.id = rl.stock_lot_id
       where rl.run_id = NEW.id
       order by l.site_id, l.material_type_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(bucket.site_id::text || bucket.material_type_id::text || '', 0));
    end loop;

    -- Ordered too: two runs sharing lots must take them the same way round.
    for it in select stock_lot_id from public.cost_price_run_lots
               where run_id = NEW.id order by stock_lot_id loop
      select * into lot from public.stock_lots where id = it.stock_lot_id for update;
      if lot.id is null then
        raise exception 'stock lot % not found', it.stock_lot_id;
      end if;
      if lot.status <> 'available' then
        raise exception 'stock lot % already left stock (sold elsewhere)', it.stock_lot_id;
      end if;
      if exists (select 1 from public.gate_passes
                  where stock_lot_id = lot.id and status in ('pending', 'issued', 'acknowledged')) then
        raise exception 'Lot is on a live gate pass — cancel the pass first.' using errcode = 'GP007';
      end if;
      -- 0171: consumed into a batch, NOT sold. The material does leave
       -- stock (the movement below), but who bought it and for how much
       -- is recorded by a bulk sale, which is a separate event.
       update public.stock_lots set status = 'consumed' where id = lot.id;
      insert into public.stock_movements (
        site_id, material_type_id, grade, weight, direction, recorded_by, reason
      ) values (
        lot.site_id, lot.material_type_id, null, lot.weight_kg, 'out',
        coalesce(NEW.approved_by, auth.uid()), 'mixed_batch'
      );
    end loop;
  end if;
  return NEW;
end; $function$;

comment on function public._cost_price_runs_approve() is
  'On approval, consumes each lot into the batch and takes its weight out of '
  'stock. Sets consumed, not sold - a run has no buyer and no selling price; '
  'a bulk sale records those. See 0171.';

-- A sale is revenue, not a second outflow. See consequence (1) above.
create or replace function public._bulk_sales_after()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- Deliberately empty of stock effects since 0171: the weight left stock when
  -- the material was costed into a batch. Kept as a trigger so the hook stays
  -- here, named and findable the next time a sale needs to do something on
  -- approval, rather than being silently dropped.
  return NEW;
end;
$function$;

comment on function public._bulk_sales_after() is
  'Hook for bulk-sale approval. Writes no stock movement since 0171: the '
  'material leaves stock when it is costed into a batch, and a second out '
  'movement would be refused for insufficient stock.';

-- Relabel the history that can be proven.
--
-- _stock_lots_approved_run_freeze (CP001, from 0160/T5) refuses exactly this
-- update: it stops a lot in an approved run moving OFF 'sold', which is what
-- keeps an approved run from being quietly reversed. That protection is right
-- and stays. It is suspended for this one statement only — a trigger disabled
-- and re-enabled inside the migration's own transaction, so no bypass flag is
-- left behind for anything else to use later.
alter table public.stock_lots disable trigger t_stock_lots_approved_run_freeze;

update public.stock_lots sl
   set status = 'consumed'
 where sl.status = 'sold'
   and exists (
     select 1 from public.cost_price_run_lots rl
       join public.cost_price_runs r on r.id = rl.run_id
      where rl.stock_lot_id = sl.id and r.approval_status = 'approved')
   and not exists (
     select 1 from public.gate_passes gp where gp.stock_lot_id = sl.id);

alter table public.stock_lots enable trigger t_stock_lots_approved_run_freeze;

-- Carry T5's protection into the new vocabulary.
--
-- The guard froze lots whose status was 'sold'. From now on an approved run
-- leaves its lots 'consumed', so without this the guard would protect nothing
-- a run produces and an approved run WOULD become reversible — a protection
-- lost by renaming rather than by decision. It now holds a lot in an approved
-- run at whatever terminal status it reached. Reproduced verbatim from the live
-- definition apart from that one condition.
create or replace function public._stock_lots_approved_run_freeze()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  if (NEW.weight_kg         is distinct from OLD.weight_kg
      or NEW.cost_price_per_kg is distinct from OLD.cost_price_per_kg
      or NEW.site_id           is distinct from OLD.site_id
      or NEW.material_type_id  is distinct from OLD.material_type_id
      or (OLD.status in ('sold', 'consumed') and NEW.status is distinct from OLD.status))
     and exists (select 1 from public.cost_price_run_lots x
                   join public.cost_price_runs r on r.id = x.run_id
                  where x.stock_lot_id = OLD.id and r.approval_status = 'approved') then
    raise exception 'Approved cost price runs cannot be changed.' using errcode = 'CP001';
  end if;
  return NEW;
end;
$function$;
