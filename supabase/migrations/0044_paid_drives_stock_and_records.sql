-- ─── "Paid" drives the records ───────────────────────────────────────────────
-- 1. Only a PAID advance is recorded as the supplier's debt (the money is only
--    truly given once the accountant disburses it).
-- 2. When the accountant marks a batch settlement PAID, the supply is taken into
--    stock (a lot + a ledger movement per material) and the visit advances to
--    'stocked'.
-- (Consumables/expenses only counting once paid is handled in the reporting
--  queries — no schema change needed.)

-- 1. Supplier debt = paid advances − deductions.
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_naira) from public.advances
                   where supplier_id = _supplier_id and approval_status = 'paid'), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id), 0);
$$;

-- 2a. Allow the settlement-paid path to move a visit to 'stocked'.
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_submitted_xrf boolean;
  has_lines boolean;
  all_exempt boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;

  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'),
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),
    ('in_qc','pricing'),
    ('pricing','in_accounting'),
    ('pricing','exited'),
    ('pricing','stocked'),               -- settlement paid → stocked
    ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','stocked'),         -- settlement paid → stocked
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state using errcode = '22000';
  end if;

  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot enter QC without material lines'; end if;
  end if;

  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis)
      into all_exempt;
    if not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end; $$;

-- 2b. On settlement paid: take each batch line into stock + advance the visit.
create or replace function public._batch_settlements_stock_on_paid()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  vm record;
  v_supplier uuid;
begin
  if NEW.status = 'paid' and OLD.status is distinct from 'paid' then
    select supplier_id into v_supplier from public.visits where id = NEW.visit_id;
    for vm in select * from public.visit_materials where visit_id = NEW.visit_id loop
      if vm.weight_kg > 0 then
        insert into public.stock_lots (
          site_id, material_type_id, supplier_id, ref_visit_material_id,
          weight_kg, cost_price_per_kg, recorded_by
        ) values (
          NEW.site_id, vm.material_type_id, v_supplier, vm.id,
          vm.weight_kg, vm.unit_price, NEW.paid_by
        );
        -- The ledger 'in' movement also drives the visit → 'stocked' transition
        -- (via _stock_movements_after) and feeds the "materials at hand" view.
        insert into public.stock_movements (
          site_id, material_type_id, grade, weight, direction, recorded_by, reason, ref_visit_id
        ) values (
          NEW.site_id, vm.material_type_id, null, vm.weight_kg, 'in', NEW.paid_by, 'purchase_intake', NEW.visit_id
        );
      end if;
    end loop;
  end if;
  return NEW;
end; $$;

create trigger t_batch_settlements_stock
  after update of status on public.batch_settlements
  for each row execute function public._batch_settlements_stock_on_paid();
