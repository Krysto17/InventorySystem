-- ─── Cross-site QC (New-Site QC analyses every site's XRF) ───────────────────
-- The only QC analyst is at New-Site, so all materials that need XRF, from any
-- site, are analysed by QC there. QC can therefore read visits / material lines
-- / XRF across sites, and record/edit the XRF for any site's visit while it is
-- in the analysis→pricing window. (Magnetic/receiving stays site-scoped.)

drop policy if exists "visits: read own site or cross-site reporter" on public.visits;
create policy "visits: read own site or cross-site reporter"
  on public.visits for select to authenticated
  using (
    site_id = public.current_site()
    or public.has_cross_site_read()
    or public.current_role() = 'qc'
  );

drop policy if exists "visit_materials: read own site or cross-site reporter" on public.visit_materials;
create policy "visit_materials: read own site or cross-site reporter"
  on public.visit_materials for select to authenticated
  using (
    public.has_cross_site_read()
    or public.current_role() = 'qc'
    or exists (
      select 1 from public.visits v
      where v.id = visit_materials.visit_id and v.site_id = public.current_site()
    )
  );

drop policy if exists "xrf_records: owner/gm/manager/qc read" on public.xrf_records;
create policy "xrf_records: owner/gm/manager/qc read"
  on public.xrf_records for select to authenticated
  using (
    public.is_owner()
    or public.is_general_manager()
    or public.current_role() = 'qc'  -- QC reads any site's XRF (cross-site analyst)
    or (public.current_role() = 'manager' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id and v.site_id = public.current_site()
    ))
  );

-- QC records / edits an XRF for ANY site's visit in the analysis→pricing window.
drop policy if exists "xrf_records: qc inserts before accounting" on public.xrf_records;
create policy "xrf_records: qc inserts before accounting"
  on public.xrf_records for insert to authenticated
  with check (
    public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    )
  );

drop policy if exists "xrf_records: qc updates before accounting" on public.xrf_records;
create policy "xrf_records: qc updates before accounting"
  on public.xrf_records for update to authenticated
  using (
    public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    )
  )
  with check (
    public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    )
  );
