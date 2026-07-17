-- ─── General manager manages technical config (material types + machines) ────
-- The general manager (New-Site) is the technical lead, so they can define/edit
-- the material types and machines (rates) alongside the owner. Site managers
-- still cannot. Additive GM policies (OR'd with the existing owner policies).

create policy "material_types: gm inserts"
  on public.material_types for insert to authenticated
  with check (public.is_general_manager());
create policy "material_types: gm updates"
  on public.material_types for update to authenticated
  using (public.is_general_manager()) with check (public.is_general_manager());

create policy "machines: gm inserts"
  on public.machines for insert to authenticated
  with check (public.is_general_manager());
create policy "machines: gm updates"
  on public.machines for update to authenticated
  using (public.is_general_manager()) with check (public.is_general_manager());
