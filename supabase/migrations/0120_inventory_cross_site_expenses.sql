-- ─── The inventory officer runs expenses for the whole organisation ─────────
-- Inventory is not a site posting: one officer logs every site's expenses, so
-- they read expenses across all sites and choose the site an expense belongs
-- to. Approval stays with the owner and payment with the accountant, and an
-- expense the owner has already ruled on is out of inventory's hands.
--
-- Also stamps who authorised a release when a line is withdrawn, so the gate
-- pass it raises names the manager/owner that signed it off (cf. 0119).

-- Reading: inventory sees every site's expenses.
drop policy if exists "consumables: read own site or cross-site reporter" on public.consumables;
create policy "consumables: read own site or cross-site reporter"
  on public.consumables for select to authenticated
  using (
    site_id = public.current_site()
    or public.has_cross_site_read()
    or public.current_role() = 'inventory'
  );

-- Logging: inventory picks the site; everyone else stays on their own.
drop policy if exists "consumables: inventory/manager/owner insert" on public.consumables;
create policy "consumables: inventory/manager/owner insert"
  on public.consumables for insert to authenticated
  with check (
    public.is_owner()
    or public.current_role() = 'inventory'
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

-- Correcting: inventory may fix or withdraw an expense until the owner has
-- ruled on it. After that it is a decided payable — manager/owner only.
drop policy if exists "consumables: site roles update own site" on public.consumables;
create policy "consumables: site roles update own site"
  on public.consumables for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'inventory' and approval_status = 'pending')
    or (public.current_role() in ('manager', 'accounting') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and approval_status = 'pending')
    or (public.current_role() in ('manager', 'accounting') and site_id = public.current_site())
  );

drop policy if exists "consumables: manager/owner delete unpaid" on public.consumables;
create policy "consumables: manager/owner delete unpaid"
  on public.consumables for delete to authenticated
  using (
    approval_status <> 'paid'
    and (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'inventory' and approval_status = 'pending')
      or (public.current_role() = 'manager' and site_id = public.current_site())
    )
  );

-- A released line's gate pass carries the signature of whoever released it.
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
      (site_id, supplier_id, material_type_id, weight_kg, reason, visit_material_id,
       issued_by, authorized_by, authorized_at)
    values (v_site, v_supplier, v_mat, v_weight,
            coalesce(nullif(p_reason, ''), 'Released — does not meet specification/pricing'),
            p_line_id, auth.uid(), auth.uid(), now());
  end if;
end; $$;
