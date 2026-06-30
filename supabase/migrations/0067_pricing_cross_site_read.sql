-- ─── Cross-site read for pricing + processing_records (#5) ───────────────────
-- The pricing and processing_records read policies predate cross-site read and
-- only allowed owner (is_owner) or own-site. The general manager (cross-site
-- reporter, not owner) therefore couldn't see other sites' prices/fees — so an
-- old-site manager's price never appeared on the GM's dashboard/settlement.
-- Bring both in line with has_cross_site_read() (owner + accounting + GM).

drop policy if exists "pricing: read own site" on public.pricing;
create policy "pricing: read own site or cross-site reporter"
  on public.pricing
  for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = pricing.visit_id
                 and v.site_id = public.current_site())
  );

drop policy if exists "processing_records: read own site" on public.processing_records;
create policy "processing_records: read own site or cross-site reporter"
  on public.processing_records
  for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = processing_records.visit_id
                 and v.site_id = public.current_site())
  );

-- The general manager needs to see every site's XRF results in one table (#4).
-- XRF stays confidential (NOT exposed to accounting) — add only the GM, not the
-- full has_cross_site_read() set.
drop policy if exists "xrf_records: owner/manager/qc read" on public.xrf_records;
create policy "xrf_records: owner/gm/manager/qc read"
  on public.xrf_records
  for select to authenticated
  using (
    public.is_owner()
    or public.is_general_manager()
    or (
      public.current_role() in ('manager','qc')
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
      )
    )
  );
