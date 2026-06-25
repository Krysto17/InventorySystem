-- ─── Iron material type + processing records material lines ─────────────────
-- New-Site processing weighs iron at intake. Add Iron to the catalog and let
-- the processing clerk add material lines (weight + comment; a supplier can have
-- several) while the visit is in processing. The General manager sees all
-- comments via cross-site read on visit_materials.

insert into public.material_types (name, active)
  select 'Iron', true
  where not exists (select 1 from public.material_types where name = 'Iron');

create policy "visit_materials: processing inserts when in_processing"
  on public.visit_materials for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_processing')
    )
  );

-- Processing may also edit/delete its own draft lines while still in processing.
drop policy if exists "visit_materials: receiving/manager update own site while open" on public.visit_materials;
create policy "visit_materials: receiving/processing/manager update own site while open"
  on public.visit_materials for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() in ('receiving', 'processing', 'manager')
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() in ('receiving', 'processing', 'manager')
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  );

create policy "visit_materials: processing deletes own site while in_processing"
  on public.visit_materials for delete to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_processing')
    )
  );
