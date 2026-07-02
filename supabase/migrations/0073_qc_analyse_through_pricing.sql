-- ─── QC can analyse a line through the pricing stages ────────────────────────
-- Previously QC could only insert an XRF while the visit was in_qc, and could
-- only edit it until pricing acted. So when a manager skipped analysis straight
-- to pricing, QC could no longer run the analysis at all. Allow QC to record /
-- edit an XRF while the visit is in_qc, pricing, or awaiting_price_approval
-- (i.e. any time before it reaches accounting).

drop policy if exists "xrf_records: qc inserts when visit in_qc" on public.xrf_records;
create policy "xrf_records: qc inserts before accounting"
  on public.xrf_records for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.site_id = public.current_site()
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    ))
  );

drop policy if exists "xrf_records: qc updates until pricing acts" on public.xrf_records;
create policy "xrf_records: qc updates before accounting"
  on public.xrf_records for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.site_id = public.current_site()
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    ))
  )
  with check (
    public.is_owner()
    or (public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.site_id = public.current_site()
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    ))
  );
