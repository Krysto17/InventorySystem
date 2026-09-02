-- ─── The inventory employee runs the cost-price module ──────────────────────
-- 0039 narrowed the cost-price dashboard to manager + owner. But the module
-- mixes STOCK LOTS, and stock is the inventory employee's lane: they book the
-- intake, they run lot sales and bulk sales. So the inventory role now forms
-- mixing batches and computes weighted cost prices too.
--
-- Scope: their OWN SITE, the way every other inventory write is scoped
-- (`stock_lots`, `lot_sales`), and unlike the general manager whose cost-price
-- read is role-wide. Nothing about approval changes — a batch still only turns
-- into a sale when the OWNER approves it (the with-check on the update policy
-- keeps a self-approval out), and an approved batch stays locked for everyone.

-- ─── 1. cost_price_runs ─────────────────────────────────────────────────────
drop policy if exists "cost_price_runs: manager/owner read" on public.cost_price_runs;
create policy "cost_price_runs: manager/inventory/owner read"
  on public.cost_price_runs for select to authenticated
  using (
    public.is_owner()
    or public.current_role() = 'manager'
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

drop policy if exists "cost_price_runs: manager inserts own site" on public.cost_price_runs;
create policy "cost_price_runs: manager/inventory insert own site"
  on public.cost_price_runs for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() in ('manager', 'inventory') and site_id = public.current_site())
  );

drop policy if exists "cost_price_runs: owner/gm edit unapproved" on public.cost_price_runs;
create policy "cost_price_runs: owner/gm/inventory edit unapproved"
  on public.cost_price_runs for update to authenticated
  using (
    (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'inventory' and site_id = public.current_site())
    )
    and approval_status is distinct from 'approved'
  )
  with check (
    (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'inventory' and site_id = public.current_site())
    )
    and approval_status is distinct from 'approved'
  );

drop policy if exists "cost_price_runs: owner/gm delete unapproved" on public.cost_price_runs;
create policy "cost_price_runs: owner/gm/inventory delete unapproved"
  on public.cost_price_runs for delete to authenticated
  using (
    (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'inventory' and site_id = public.current_site())
    )
    and approval_status is distinct from 'approved'
  );

-- ─── 2. cost_price_run_lots ─────────────────────────────────────────────────
-- The `cost_price_runs` sub-selects below are themselves RLS-filtered, so an
-- inventory user only ever reaches the lots of a run on their own site.
drop policy if exists "cost_price_run_lots: manager/owner read" on public.cost_price_run_lots;
create policy "cost_price_run_lots: manager/inventory/owner read"
  on public.cost_price_run_lots for select to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'inventory')
      and exists (select 1 from public.cost_price_runs r where r.id = cost_price_run_lots.run_id)
    )
  );

drop policy if exists "cost_price_run_lots: manager author attaches lots" on public.cost_price_run_lots;
create policy "cost_price_run_lots: author attaches lots"
  on public.cost_price_run_lots for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'inventory')
      and exists (select 1 from public.cost_price_runs r
                  where r.id = cost_price_run_lots.run_id and r.created_by = auth.uid())
    )
  );

drop policy if exists "cost_price_run_lots: owner/gm detach unapproved" on public.cost_price_run_lots;
create policy "cost_price_run_lots: owner/gm/inventory detach unapproved"
  on public.cost_price_run_lots for delete to authenticated
  using (
    (public.is_owner() or public.is_general_manager() or public.current_role() = 'inventory')
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  );

-- ─── 3. cost_price_run_extras (external, non-stock materials) ───────────────
drop policy if exists "cost_price_run_extras: owner/gm read" on public.cost_price_run_extras;
create policy "cost_price_run_extras: owner/gm/inventory read"
  on public.cost_price_run_extras for select to authenticated
  using (
    public.is_owner()
    or public.is_general_manager()
    or (
      public.current_role() = 'inventory'
      and exists (select 1 from public.cost_price_runs r where r.id = cost_price_run_extras.run_id)
    )
  );

drop policy if exists "cost_price_run_extras: owner/gm insert" on public.cost_price_run_extras;
create policy "cost_price_run_extras: owner/gm/inventory insert"
  on public.cost_price_run_extras for insert to authenticated
  with check (
    public.is_owner()
    or public.is_general_manager()
    or (
      public.current_role() = 'inventory'
      and exists (select 1 from public.cost_price_runs r where r.id = cost_price_run_extras.run_id)
    )
  );

drop policy if exists "cost_price_run_extras: owner/gm edit unapproved" on public.cost_price_run_extras;
create policy "cost_price_run_extras: owner/gm/inventory edit unapproved"
  on public.cost_price_run_extras for update to authenticated
  using (
    (public.is_owner() or public.is_general_manager() or public.current_role() = 'inventory')
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  )
  with check (
    public.is_owner() or public.is_general_manager() or public.current_role() = 'inventory'
  );

drop policy if exists "cost_price_run_extras: owner/gm remove unapproved" on public.cost_price_run_extras;
create policy "cost_price_run_extras: owner/gm/inventory remove unapproved"
  on public.cost_price_run_extras for delete to authenticated
  using (
    (public.is_owner() or public.is_general_manager() or public.current_role() = 'inventory')
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  );
