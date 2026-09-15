-- ─── 0154: the inventory employee reads stock at every site ────────────────
-- 0149 gave inventory the cost-price module but scoped it to their own site,
-- the way inventory writes are scoped. In practice that hid stock they are
-- expected to mix: both inventory accounts are posted at New-Site, while 143 of
-- the 489 available lots sit at Old-Site — which has no inventory account at
-- all — and 15 of the 32 real mixing batches combine lots from two sites.
-- Business ruling (2026-09-10): inventory can READ stock across sites.
--
-- READ ONLY. Every inventory write stays site-scoped and is untouched here:
-- stock_lots / stock_movements INSERT remain own-site, a cost-price run is still
-- created on the employee's own site, and only the owner approves a batch into
-- a sale. stock_confirmations already let inventory read every site.
-- stock_balances, stocked_materials, material_cost_basis and site_rollups are
-- security_invoker views, so they follow these policies automatically.

drop policy "stock_lots: read own site or cross-site reporter" on public.stock_lots;
create policy "stock_lots: read own site, cross-site or inventory"
  on public.stock_lots for select to authenticated
  using (
    site_id = public.current_site()
    or public.has_cross_site_read()
    or public."current_role"() = 'inventory'
  );

drop policy "stock_movements: read own site or cross-site reporter" on public.stock_movements;
create policy "stock_movements: read own site, cross-site or inventory"
  on public.stock_movements for select to authenticated
  using (
    site_id = public.current_site()
    or public.has_cross_site_read()
    or public."current_role"() = 'inventory'
  );
