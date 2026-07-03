-- ─── General manager (New-Site) is a cross-site WRITE authority ──────────────
-- Previously only the owner could write across sites; managers were site-scoped.
-- The New-Site manager is the general manager and now creates/edits/deletes
-- records at any site. Implemented additively: a GM-write policy per table is
-- OR'd with the existing (site-scoped) manager policies, and the manager RPCs
-- also accept the GM. Site managers stay site-scoped; the owner is unchanged.

-- ── Additive cross-site write policies for the GM ────────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'visit_materials','pricing','batch_settlements','utility_charges',
    'advances','advance_deductions','gate_exit_authorizations','consumables'
  ] loop
    execute format($f$
      create policy "%1$s: general manager writes cross-site (insert)"
        on public.%1$s for insert to authenticated with check (public.is_general_manager());
      create policy "%1$s: general manager writes cross-site (update)"
        on public.%1$s for update to authenticated
        using (public.is_general_manager()) with check (public.is_general_manager());
      create policy "%1$s: general manager writes cross-site (delete)"
        on public.%1$s for delete to authenticated using (public.is_general_manager());
    $f$, tbl);
  end loop;
end $$;

-- ── Manager RPCs also accept the general manager (cross-site) ────────────────
create or replace function public.manager_skip_to_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to skip analysis for this visit';
  end if;
  if v_state <> 'in_qc' then raise exception 'visit is not in analysis'; end if;
  update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
  update public.visits set state = 'pricing' where id = p_visit_id;
end; $$;

create or replace function public.unsettle_line(p_line_id uuid, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_site uuid; v_supplier uuid; v_mat uuid; v_weight numeric;
begin
  select vm.visit_id, v.site_id, v.supplier_id, vm.material_type_id, vm.weight_kg
    into v_visit, v_site, v_supplier, v_mat, v_weight
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to unsettle this line';
  end if;
  update public.visit_materials
    set settlement_status = 'unsettled', unsettled_reason = nullif(p_reason, '')
    where id = p_line_id;
  if not exists (select 1 from public.gate_passes where visit_material_id = p_line_id and status <> 'cancelled') then
    insert into public.gate_passes
      (site_id, supplier_id, material_type_id, weight_kg, reason, visit_material_id, issued_by)
    values (v_site, v_supplier, v_mat, v_weight,
            coalesce(nullif(p_reason, ''), 'Unsettled — does not meet specification/pricing'),
            p_line_id, auth.uid());
  end if;
end; $$;

create or replace function public.resettle_line(p_line_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  select v.site_id into v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_site is null then raise exception 'line not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to re-settle this line';
  end if;
  update public.visit_materials set settlement_status = 'settled', unsettled_reason = null where id = p_line_id;
  update public.gate_passes set status = 'cancelled' where visit_material_id = p_line_id and status <> 'cancelled';
end; $$;

create or replace function public.remove_line(p_line_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_site uuid;
begin
  select vm.visit_id, v.site_id into v_visit, v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to remove this line';
  end if;
  delete from public.visit_materials where id = p_line_id;
  update public.pricing set unit_price = unit_price where visit_id = v_visit;
end; $$;
