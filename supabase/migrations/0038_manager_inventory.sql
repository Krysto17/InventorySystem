-- ─── Blueprint reconciliation: inventory is the Manager's responsibility ──────
-- The blueprint has no standalone inventory role — the Manager owns inventory
-- oversight. Grant the manager every inventory write the `inventory` role had
-- (purchase intake, bulk sales, stock lots, lot sales). Reads are already
-- cross-site for managers (Phase 10). The `inventory` role is retained and
-- still works; the manager is now a superset. Consumables already allow
-- manager inserts (Phase 11).

-- stock_movements: purchase intake
drop policy if exists "stock_movements: inventory inserts on own site" on public.stock_movements;
create policy "stock_movements: inventory/manager inserts on own site"
  on public.stock_movements for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('inventory', 'manager')
      and site_id = public.current_site()
      and reason = 'purchase_intake'
    )
  );

-- bulk_sales (legacy fungible)
drop policy if exists "bulk_sales: inventory inserts on own site" on public.bulk_sales;
create policy "bulk_sales: inventory/manager inserts on own site"
  on public.bulk_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() in ('inventory', 'manager') and site_id = public.current_site())
  );

-- stock_lots
drop policy if exists "stock_lots: inventory inserts own site" on public.stock_lots;
create policy "stock_lots: inventory/manager inserts own site"
  on public.stock_lots for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() in ('inventory', 'manager') and site_id = public.current_site())
  );

-- lot_sales
drop policy if exists "lot_sales: inventory inserts own site" on public.lot_sales;
create policy "lot_sales: inventory/manager inserts own site"
  on public.lot_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() in ('inventory', 'manager') and site_id = public.current_site())
  );

-- lot_sale_items
drop policy if exists "lot_sale_items: inventory inserts on pending own-site sale" on public.lot_sale_items;
create policy "lot_sale_items: inventory/manager inserts on pending own-site sale"
  on public.lot_sale_items for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('inventory', 'manager')
      and exists (select 1 from public.lot_sales s
                  where s.id = lot_sale_items.lot_sale_id
                    and s.site_id = public.current_site()
                    and s.approval_status = 'pending')
    )
  );
