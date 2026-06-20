-- ─── Cost-price "mixing batch" now sells the stock it combines ───────────────
-- The manager searches/sorts available stock lots, hand-picks lots to mix into
-- one batch, and forms the batch. Forming a SOLD batch removes each lot from
-- stock (lot flipped to 'sold' + a 'mixed_batch' ledger 'out' movement) and the
-- run records the weighted cost price. The owner can then review every sold
-- batch with its lots + cost prices.
--
-- The manager has no direct stock write access (revoked in 0045), so the stock
-- mutation runs in a SECURITY DEFINER trigger: the manager only inserts the
-- cost_price_runs row + its cost_price_run_lots (already allowed by 0034 RLS).

-- ── 1. Mark which runs are committed sales vs. plain saved computations ───────
alter table public.cost_price_runs
  add column if not exists sold    boolean not null default false,
  add column if not exists sold_at timestamptz;

-- ── 2. A mixed batch is a new stock-ledger 'out' reason ──────────────────────
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('purchase_intake', 'bulk_sale', 'adjustment', 'gate_release', 'mixed_batch'));

-- ── 3. Attaching a lot to a SOLD run sells that lot ──────────────────────────
create or replace function public._cost_price_run_lots_sell()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  run record;
  lot record;
begin
  select * into run from public.cost_price_runs where id = NEW.run_id;
  if run.id is null or not run.sold then
    return NEW;   -- plain saved computation: sells nothing
  end if;

  select * into lot from public.stock_lots where id = NEW.stock_lot_id for update;
  if lot.id is null then
    raise exception 'stock lot % not found', NEW.stock_lot_id;
  end if;
  if lot.status <> 'available' then
    raise exception 'stock lot % is already sold', NEW.stock_lot_id;
  end if;

  update public.stock_lots set status = 'sold' where id = lot.id;

  insert into public.stock_movements (
    site_id, material_type_id, grade, weight, direction, recorded_by, reason
  ) values (
    lot.site_id, lot.material_type_id, null, lot.weight_kg, 'out',
    coalesce(auth.uid(), run.created_by), 'mixed_batch'
  );

  return NEW;
end; $$;

-- Runs before the recompute trigger (t_cost_price_run_lots_after) alphabetically;
-- order does not matter — both only read/write their own rows.
create trigger t_cost_price_run_lots_sell
  after insert on public.cost_price_run_lots
  for each row execute function public._cost_price_run_lots_sell();
