-- ─── Two consuming invariants could be broken by concurrency ────────────────
-- Both guards below are BEFORE INSERT triggers that read a total, compare, and
-- let the row in — holding nothing. Under READ COMMITTED neither transaction
-- sees the other's uncommitted row, so both read the same total, both pass, and
-- both insert. Reproduced locally, before this migration:
--
--   stock:    100 kg bucket, two concurrent 100 kg 'out' movements
--             -> both accepted, balance -100 kg
--   advances: 50,000 owed, two concurrent 50,000 deductions
--             -> both accepted, 100,000 deducted, outstanding -50,000
--
-- Neither has fired in production yet: 0 negative stock buckets and 0 suppliers
-- with a negative balance when this was written. This closes them before they do.
--
-- Same defect class as 0151, but the two need different mechanisms, because only
-- one of them has a row to lock:
--
--   * advance_deductions -> the supplier IS the aggregate root the sums hang off,
--     so this is 0151's `for update` applied to public.suppliers.
--   * stock_movements    -> the grain is (site, material, grade) and no row
--     represents it (stock_balances is a view), so it takes a transaction-scoped
--     advisory lock keyed to exactly that tuple. Not a table lock, not
--     material_types, no new balance table, nothing outside Postgres.
--
-- Both functions are restated verbatim from their live definitions, verified
-- byte-identical between production and a local database first. The only changes
-- are the added lock in each, plus the message fix noted inline. 0149-0152 are
-- untouched, and no table, policy, grant or trigger binding changes.

CREATE OR REPLACE FUNCTION public._advance_deductions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare outstanding numeric;
begin
  -- Hold this supplier for the rest of the transaction. Everything below — the
  -- outstanding figure, the check and the insert — has to see one consistent
  -- view of what they owe, and only the lock provides it.
  -- supplier_outstanding_debt is derived from advances, advance_shares and
  -- advance_deductions, so there is no balance row to lock; the supplier is the
  -- aggregate root those sums hang off. One supplier at a time: deductions for
  -- different suppliers never contend.
  perform 1 from public.suppliers where id = NEW.supplier_id for update;

  if NEW.kind = 'processing' then
    outstanding := public.supplier_processing_debt(NEW.supplier_id);
  else
    outstanding := public.supplier_outstanding_debt(NEW.supplier_id);
  end if;
  if NEW.amount > outstanding then
    raise exception 'deduction % exceeds outstanding debt % (%)', NEW.amount, outstanding, NEW.kind
      using errcode = '23514';
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public._stock_movements_balance_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_balance numeric;
begin
  if NEW.direction = 'out' then
    -- Serialise consumers of THIS bucket before reading it. The invariant is the
    -- aggregate weight of (site, material, grade) and no row represents that, so
    -- there is nothing to take `for update` on. A transaction-scoped advisory
    -- lock is keyed to exactly that grain: released on commit and on rollback,
    -- other buckets untouched, and 'in' movements never take it.
    --
    -- The cost-price path already locks each stock_lot, which is a different
    -- invariant — it stops one lot being sold twice. It does not stop a run
    -- approval and an owner adjustment from both reading the same bucket total,
    -- which was reproduced driving a 100 kg bucket to -100 kg.
    perform pg_advisory_xact_lock(
      hashtextextended(
        NEW.site_id::text || NEW.material_type_id::text || coalesce(NEW.grade, ''),
        0
      )
    );

    select coalesce(
      sum(case when direction = 'in' then weight else -weight end), 0
    )
      into current_balance
      from public.stock_movements
     where site_id          = NEW.site_id
       and material_type_id = NEW.material_type_id
       and coalesce(grade, '') = coalesce(NEW.grade, '');

    if NEW.weight > current_balance then
      -- `%` is plpgsql's only placeholder, so `%.3f` printed the value followed
      -- by a literal ".3f" — operators saw "available 0.3f kg".
      raise exception 'insufficient stock: available % kg, requested % kg',
        to_char(current_balance, 'FM999999999990.000'),
        to_char(NEW.weight, 'FM999999999990.000')
        using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$function$;


-- ─── And the caller that takes a lot lock first ─────────────────────────────
-- The advisory lock above is the authoritative guard and stays exactly where it
-- is: gate release, stock adjustments and any future 'out' writer rely on it,
-- and none of them holds a row lock when they reach it.
--
-- The cost-price approval is the one path that already locks stock_lots. Taking
-- the bucket lock inside its loop put the two resources in opposite orders
-- against a competing approval, which deadlocked (40P01) in testing. It now
-- takes the buckets first, so the global order is bucket -> lot everywhere.
-- Nothing else about the approval changes.

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
    -- the buckets first makes the order globally bucket -> lot, and no other
    -- 'out' path takes a lot lock at all (gate release reads the lot without
    -- `for update`; an adjustment touches no lot), so no path can invert it.
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
      update public.stock_lots set status = 'sold' where id = lot.id;
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
