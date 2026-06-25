-- ─── Receiving can delete a material line (while still in receiving) ─────────
-- Lines are drafts during receiving; let the receiving clerk remove a wrong one
-- before the batch advances (own site, state = in_receiving). Owner anytime.
-- xrf_records cascade-delete with the line (FK on delete cascade).

grant delete on public.visit_materials to authenticated;

create policy "visit_materials: receiving deletes own site while in_receiving"
  on public.visit_materials for delete to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
  );
