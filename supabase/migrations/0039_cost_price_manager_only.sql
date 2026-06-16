-- ─── Blueprint update: cost-price dashboard is Manager-only ──────────────────
-- The Accountant no longer has cost-price access (blueprint: "Cost Price
-- Dashboard — Access limited to: Manager"). Owner/Director retains it as the
-- super-role. Tighten the Phase 11 policies (which allowed manager + accounting)
-- to manager + owner.

drop policy if exists "cost_price_runs: read own site or cross-site reporter" on public.cost_price_runs;
create policy "cost_price_runs: manager/owner read"
  on public.cost_price_runs for select to authenticated
  using (public.is_owner() or public.current_role() = 'manager');

drop policy if exists "cost_price_runs: manager/accounting insert own site" on public.cost_price_runs;
create policy "cost_price_runs: manager inserts own site"
  on public.cost_price_runs for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

drop policy if exists "cost_price_run_lots: read via run" on public.cost_price_run_lots;
create policy "cost_price_run_lots: manager/owner read"
  on public.cost_price_run_lots for select to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.cost_price_runs r where r.id = cost_price_run_lots.run_id)
    )
  );

drop policy if exists "cost_price_run_lots: author attaches lots" on public.cost_price_run_lots;
create policy "cost_price_run_lots: manager author attaches lots"
  on public.cost_price_run_lots for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.cost_price_runs r
                  where r.id = cost_price_run_lots.run_id and r.created_by = auth.uid())
    )
  );
