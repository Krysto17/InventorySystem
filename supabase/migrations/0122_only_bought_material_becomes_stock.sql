-- ─── Only material the company actually bought becomes stock ────────────────
-- Marking a batch paid stocked EVERY line on the visit, with no check on
-- whether the line was released back to the supplier on a gate pass, or whether
-- a price was ever agreed on it. So material that had physically left the yard
-- kept showing as stock at hand, and unpriced material padded the tonnage while
-- contributing nothing to the value.
--
-- Stock is now only what was released to nobody and had a price agreed.

-- A lot that went back out is not 'sold' — it needs its own status.
alter table public.stock_lots drop constraint if exists stock_lots_status_check;
alter table public.stock_lots add constraint stock_lots_status_check
  check (status in ('available', 'sold', 'released'));

create or replace function public._batch_settlements_stock_on_paid()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  vm record;
  v_supplier uuid;
begin
  if NEW.status = 'paid' and OLD.status is distinct from 'paid' then
    select supplier_id into v_supplier from public.visits where id = NEW.visit_id;
    -- Released lines left on a gate pass, and an unpriced line was never
    -- bought — neither becomes stock.
    for vm in
      select * from public.visit_materials
       where visit_id = NEW.visit_id
         and coalesce(settlement_status, 'settled') <> 'unsettled'
         and unit_price is not null
    loop
      if vm.weight_kg > 0 then
        insert into public.stock_lots (
          site_id, material_type_id, supplier_id, ref_visit_material_id,
          weight_kg, cost_price_per_kg, recorded_by
        ) values (
          NEW.site_id, vm.material_type_id, v_supplier, vm.id,
          vm.weight_kg, vm.unit_price, NEW.paid_by
        );
        -- The ledger 'in' movement also drives the visit → 'stocked' transition
        -- (via _stock_movements_after) and feeds the stock_balances view.
        insert into public.stock_movements (
          site_id, material_type_id, grade, weight, direction, recorded_by, reason, ref_visit_id
        ) values (
          NEW.site_id, vm.material_type_id, null, vm.weight_kg, 'in', NEW.paid_by, 'purchase_intake', NEW.visit_id
        );
      end if;
    end loop;

    -- A batch whose every line was released or unpriced still has to leave
    -- awaiting_stock_intake, or it would sit in the queue forever.
    update public.visits set state = 'stocked'
     where id = NEW.visit_id and state = 'awaiting_stock_intake';
  end if;
  return NEW;
end; $$;

-- ── Correct the stock that was taken in under the old rule ──────────────────
-- Written out through the ledger, not deleted, so the correction is visible:
-- released material leaves as 'gate_release', unpriced material as an
-- 'adjustment'. Re-running this is a no-op — each lot is closed as it goes.
do $$
declare l record;
begin
  for l in
    select sl.id, sl.site_id, sl.material_type_id, sl.weight_kg, sl.recorded_by,
           vm.visit_id,
           case when vm.settlement_status = 'unsettled' then 'gate_release' else 'adjustment' end as reason
      from public.stock_lots sl
      join public.visit_materials vm on vm.id = sl.ref_visit_material_id
     where sl.status = 'available'
       and (vm.settlement_status = 'unsettled' or vm.unit_price is null)
     order by sl.created_at
  loop
    insert into public.stock_movements (
      site_id, material_type_id, grade, weight, direction, recorded_by, reason, ref_visit_id
    ) values (
      l.site_id, l.material_type_id, null, l.weight_kg, 'out',
      l.recorded_by, l.reason, l.visit_id
    );
    update public.stock_lots set status = 'released' where id = l.id;
  end loop;
end $$;
