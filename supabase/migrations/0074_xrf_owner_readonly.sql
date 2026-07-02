-- ─── XRF analysis is read-only for the owner ─────────────────────────────────
-- Only QC records/edits an XRF (through the pre-accounting stages). The owner
-- (and GM/manager) can read it but no longer write it.

drop policy if exists "xrf_records: qc inserts before accounting" on public.xrf_records;
create policy "xrf_records: qc inserts before accounting"
  on public.xrf_records for insert to authenticated
  with check (
    public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.site_id = public.current_site()
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
        and v.site_id = public.current_site()
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    )
  )
  with check (
    public.current_role() = 'qc' and exists (
      select 1 from public.visit_materials vm join public.visits v on v.id = vm.visit_id
      where vm.id = xrf_records.visit_material_id
        and v.site_id = public.current_site()
        and v.state in ('in_qc', 'pricing', 'awaiting_price_approval')
    )
  );
