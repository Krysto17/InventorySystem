-- ─── Manager may add a material line while pricing (before owner approval) ───
-- A manager can already correct existing batch lines; let them ADD a missing
-- line to the batch while it is being priced (state = pricing), before it is
-- submitted to the owner. The general manager already writes cross-site.

create policy "visit_materials: manager inserts when pricing"
  on public.visit_materials for insert to authenticated
  with check (
    public.current_role() = 'manager'
    and exists (
      select 1 from public.visits v
      where v.id = visit_materials.visit_id
        and v.site_id = public.current_site()
        and v.state = 'pricing'
    )
  );
