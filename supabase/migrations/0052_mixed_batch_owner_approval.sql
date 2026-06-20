-- ─── Mixing batches now leave stock only on OWNER approval ───────────────────
-- 0051 sold the lots the moment the manager formed the batch. The business wants
-- the owner to approve first (like bulk/lot sales): the manager submits a pending
-- batch (lots stay in stock), the owner approves (lots flip to sold + 'mixed_batch'
-- ledger 'out') or rejects (nothing leaves stock).

alter table public.cost_price_runs
  add column if not exists approval_status text
    check (approval_status is null or approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_note text;

-- Stop selling on attach — selling moves to approval time.
drop trigger if exists t_cost_price_run_lots_sell on public.cost_price_run_lots;

-- On approval, remove every attached lot from stock.
create or replace function public._cost_price_runs_approve()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  it  record;
  lot record;
begin
  if NEW.approval_status = 'approved' and OLD.approval_status is distinct from 'approved' then
    for it in select stock_lot_id from public.cost_price_run_lots where run_id = NEW.id loop
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
end; $$;

drop trigger if exists t_cost_price_runs_approve on public.cost_price_runs;
create trigger t_cost_price_runs_approve
  after update of approval_status on public.cost_price_runs
  for each row execute function public._cost_price_runs_approve();

-- The owner approves/rejects mixing batches (the only cross-site write role here).
drop policy if exists "cost_price_runs: owner approves" on public.cost_price_runs;
create policy "cost_price_runs: owner approves"
  on public.cost_price_runs for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());
