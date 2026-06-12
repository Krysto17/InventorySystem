-- ─── Phase 10 (D): Hybrid record locking ─────────────────────────────────────
-- Owner-confirmed edit policy: the recording role can edit its record until the
-- NEXT stage acts on it; after that, corrections are manager/owner-only.
--   • visit_materials: receiving edits only while the visit is still
--     in_receiving (locks the moment QC starts). Manager keeps editing (price
--     columns) while the visit is open; owner always.
--   • xrf_records: QC edits while the visit is open AND pricing has not acted
--     yet (no pricing row, no priced line); owner always.
-- All corrections remain audited via transaction_events.

create or replace function public.pricing_has_acted(_visit_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.pricing where visit_id = _visit_id)
      or exists (select 1 from public.visit_materials
                 where visit_id = _visit_id and unit_price is not null);
$$;

-- ─── visit_materials ──────────────────────────────────────────────────────────
drop policy if exists "visit_materials: receiving/manager update own site while open"
  on public.visit_materials;

create policy "visit_materials: receiving updates until QC starts"
  on public.visit_materials for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  );

-- ─── xrf_records ─────────────────────────────────────────────────────────────
drop policy if exists "xrf_records: qc updates own site while open" on public.xrf_records;

create policy "xrf_records: qc updates until pricing acts"
  on public.xrf_records for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'qc'
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
          and public.visit_is_open(vm.visit_id)
          and not public.pricing_has_acted(vm.visit_id)
      )
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'qc'
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
          and public.visit_is_open(vm.visit_id)
          and not public.pricing_has_acted(vm.visit_id)
      )
    )
  );
