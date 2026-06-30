-- ─── Per-line "unsettled": remove or gate-pass a line that fails spec/pricing ─
-- A material line that doesn't meet specification or pricing can be unsettled by
-- the manager (own site) or owner, before or after pricing. Two outcomes:
--   • Remove    — delete the line outright.
--   • Gate pass — keep the record but exclude it from the batch purchase total
--                 and issue a gate pass so the supplier can take it back out.
-- Unsettling (gate-pass path) is reversible: re-settling cancels the pass and
-- the line re-enters the purchase total.

-- 1. Line settlement status.
alter table public.visit_materials
  add column if not exists settlement_status text not null default 'settled'
    check (settlement_status in ('settled', 'unsettled')),
  add column if not exists unsettled_reason text;

-- 2. Link an auto-issued gate pass back to its line (so re-settle can cancel it).
alter table public.gate_passes
  add column if not exists visit_material_id uuid
    references public.visit_materials(id) on delete set null;

-- 3. Exclude unsettled lines from the per-visit purchase total.
create or replace function public._pricing_set_purchase_amount()
  returns trigger language plpgsql security definer set search_path = public as $$
declare w numeric; line_total numeric;
begin
  select weight into w from public.analysis_records where visit_id = NEW.visit_id;
  if w is not null and NEW.unit_price is not null then
    NEW.purchase_amount := NEW.unit_price * w;
  else
    select sum(purchase_amount) into line_total
      from public.visit_materials
      where visit_id = NEW.visit_id and settlement_status = 'settled';
    NEW.purchase_amount := line_total;
  end if;
  return NEW;
end; $$;

-- 4. Unsettle a line + issue a gate pass for the rejected material.
create or replace function public.unsettle_line(p_line_id uuid, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_site uuid; v_supplier uuid; v_mat uuid; v_weight numeric;
begin
  select vm.visit_id, v.site_id, v.supplier_id, vm.material_type_id, vm.weight_kg
    into v_visit, v_site, v_supplier, v_mat, v_weight
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to unsettle this line';
  end if;

  update public.visit_materials
    set settlement_status = 'unsettled', unsettled_reason = nullif(p_reason, '')
    where id = p_line_id;

  -- Issue a gate pass for the rejected material (unless one is already open).
  if not exists (
    select 1 from public.gate_passes
    where visit_material_id = p_line_id and status <> 'cancelled'
  ) then
    insert into public.gate_passes
      (site_id, supplier_id, material_type_id, weight_kg, reason, visit_material_id, issued_by)
    values (v_site, v_supplier, v_mat, v_weight,
            coalesce(nullif(p_reason, ''), 'Unsettled — does not meet specification/pricing'),
            p_line_id, auth.uid());
  end if;
end; $$;

-- 5. Re-settle a line: cancel its gate pass, return it to the purchase total.
create or replace function public.resettle_line(p_line_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  select v.site_id into v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_site is null then raise exception 'line not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to re-settle this line';
  end if;

  update public.visit_materials
    set settlement_status = 'settled', unsettled_reason = null
    where id = p_line_id;
  update public.gate_passes set status = 'cancelled'
    where visit_material_id = p_line_id and status <> 'cancelled';
end; $$;

-- 6. Remove a line outright (manager own-site / owner), recompute the total.
create or replace function public.remove_line(p_line_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_site uuid;
begin
  select vm.visit_id, v.site_id into v_visit, v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to remove this line';
  end if;
  delete from public.visit_materials where id = p_line_id;
  -- DELETE doesn't fire the line-change recompute trigger; nudge pricing directly.
  update public.pricing set unit_price = unit_price where visit_id = v_visit;
end; $$;

grant execute on function public.unsettle_line(uuid, text) to authenticated;
grant execute on function public.resettle_line(uuid) to authenticated;
grant execute on function public.remove_line(uuid) to authenticated;
