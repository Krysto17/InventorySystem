-- ─── Phase 10 (C): Cross-site READ for manager + accountant ─────────────────
-- The blueprint grants Owner / Manager / Accountant combined reports and
-- cross-site inventory visibility. Owner-confirmed: manager + accountant get
-- cross-site SELECT on the reporting tables below; every INSERT/UPDATE policy
-- stays site-scoped, and owner remains the only cross-site WRITE role.

create or replace function public.has_cross_site_read()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(public.current_role() in ('owner', 'manager', 'accounting'), false);
$$;

-- visits
drop policy if exists "visits: read own site" on public.visits;
create policy "visits: read own site or cross-site reporter"
  on public.visits for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- visit_materials (inventory visibility per line)
drop policy if exists "visit_materials: read own site" on public.visit_materials;
create policy "visit_materials: read own site or cross-site reporter"
  on public.visit_materials for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = visit_materials.visit_id and v.site_id = public.current_site())
  );

-- stock_movements
drop policy if exists "stock_movements: read own site" on public.stock_movements;
create policy "stock_movements: read own site or cross-site reporter"
  on public.stock_movements for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- stock_lots
drop policy if exists "stock_lots: read own site" on public.stock_lots;
create policy "stock_lots: read own site or cross-site reporter"
  on public.stock_lots for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- payments
drop policy if exists "payments: read own site" on public.payments;
create policy "payments: read own site or cross-site reporter"
  on public.payments for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = payments.visit_id and v.site_id = public.current_site())
  );

-- advances
drop policy if exists "advances: read own site" on public.advances;
create policy "advances: read own site or cross-site reporter"
  on public.advances for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- consumables
drop policy if exists "consumables: read own site" on public.consumables;
create policy "consumables: read own site or cross-site reporter"
  on public.consumables for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- lot_sales + lot_sale_items
drop policy if exists "lot_sales: read own site" on public.lot_sales;
create policy "lot_sales: read own site or cross-site reporter"
  on public.lot_sales for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

drop policy if exists "lot_sale_items: read own site" on public.lot_sale_items;
create policy "lot_sale_items: read own site or cross-site reporter"
  on public.lot_sale_items for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.lot_sales s
               where s.id = lot_sale_items.lot_sale_id and s.site_id = public.current_site())
  );
