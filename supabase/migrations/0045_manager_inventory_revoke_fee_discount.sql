-- ─── Inventory is the inventory role's; manager may discount processing fees ──
-- The dedicated inventory role now owns stock intake, bulk sales, and lot sales,
-- so the manager loses those write capabilities (manager keeps expense logging
-- via consumables). The manager may adjust (discount) a supplier's processing
-- fee on an open visit.

-- ── Revoke manager from inventory writes (back to inventory + owner) ──────────
drop policy if exists "stock_movements: inventory/manager inserts on own site" on public.stock_movements;
create policy "stock_movements: inventory inserts on own site"
  on public.stock_movements for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site() and reason = 'purchase_intake')
  );

drop policy if exists "bulk_sales: inventory/manager inserts on own site" on public.bulk_sales;
create policy "bulk_sales: inventory inserts on own site"
  on public.bulk_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

drop policy if exists "stock_lots: inventory/manager inserts own site" on public.stock_lots;
create policy "stock_lots: inventory inserts own site"
  on public.stock_lots for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

drop policy if exists "lot_sales: inventory/manager inserts own site" on public.lot_sales;
create policy "lot_sales: inventory inserts own site"
  on public.lot_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

drop policy if exists "lot_sale_items: inventory/manager inserts on pending own-site sale" on public.lot_sale_items;
create policy "lot_sale_items: inventory inserts on pending own-site sale"
  on public.lot_sale_items for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'inventory'
      and exists (select 1 from public.lot_sales s
                  where s.id = lot_sale_items.lot_sale_id
                    and s.site_id = public.current_site()
                    and s.approval_status = 'pending')
    )
  );

-- ── Manager may adjust (discount) a processing fee on an open visit ──────────
-- Reducing the utility_charges amount is the discount; all downstream totals
-- (settlement, invoices, reports) already sum that amount.
create policy "utility_charges: manager adjusts own site while open"
  on public.utility_charges for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = utility_charges.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(utility_charges.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = utility_charges.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(utility_charges.visit_id)
    )
  );
