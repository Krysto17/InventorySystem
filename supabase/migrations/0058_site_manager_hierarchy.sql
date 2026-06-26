-- ─── Per-site managers + a general (New-Site) manager ───────────────────────
-- New-Site is the main site. Its manager is the GENERAL manager: cross-site read
-- + the only manager who owns gate passes, cost-price, and reports. Managers at
-- Old-Site / Dong are SITE managers — scoped to their own site and excluded from
-- gate passes / cost-price / reports.

create or replace function public.is_general_manager()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_role() = 'manager'
    and public.current_site() = (select id from public.sites where name = 'New-Site' limit 1),
    false);
$$;

-- Narrow cross-site read: site managers lose it; only owner, accounting, and the
-- general manager keep it. This ripples through every policy that uses it
-- (visits, advances, payments, stock, …) — site managers become own-site-only.
create or replace function public.has_cross_site_read()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_role() in ('owner', 'accounting') or public.is_general_manager(),
    false);
$$;

-- ── Gate passes: owner + general manager only (site managers excluded) ───────
drop policy if exists "gate_passes: manager/owner issue" on public.gate_passes;
create policy "gate_passes: owner/general-manager issue"
  on public.gate_passes for insert to authenticated
  with check (public.is_owner() or public.is_general_manager());

drop policy if exists "gate_passes: read own site or cross-site reporter" on public.gate_passes;
create policy "gate_passes: gate own-site or cross-site reader"
  on public.gate_passes for select to authenticated
  using (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.has_cross_site_read()
  );

drop policy if exists "gate_passes: gate ack / manager-owner cancel" on public.gate_passes;
create policy "gate_passes: gate ack / general-manager-owner cancel"
  on public.gate_passes for update to authenticated
  using (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'gate' and site_id = public.current_site())
  )
  with check (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'gate' and site_id = public.current_site())
  );

-- ── Gate logs: gate (own site) + cross-site readers (no site managers) ───────
drop policy if exists "gate_logs: read own site or cross-site reporter" on public.gate_logs;
create policy "gate_logs: gate own-site or cross-site reader"
  on public.gate_logs for select to authenticated
  using (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.has_cross_site_read()
  );

-- ── Cost-price runs: owner + general manager create; cross-site readers read ──
drop policy if exists "cost_price_runs: manager inserts own site" on public.cost_price_runs;
drop policy if exists "cost_price_runs: manager/accounting insert own site" on public.cost_price_runs;
create policy "cost_price_runs: owner/general-manager insert"
  on public.cost_price_runs for insert to authenticated
  with check (
    public.is_owner()
    or (public.is_general_manager() and site_id = public.current_site())
  );

drop policy if exists "cost_price_runs: manager/owner read" on public.cost_price_runs;
drop policy if exists "cost_price_runs: read own site or cross-site reporter" on public.cost_price_runs;
-- Cost-price stays owner + general-manager ONLY (blueprint: Manager-only; the
-- general manager is the sole manager with it). NOT has_cross_site_read(),
-- which would leak it to accounting.
create policy "cost_price_runs: owner/general-manager read"
  on public.cost_price_runs for select to authenticated
  using (public.is_owner() or public.is_general_manager());

drop policy if exists "cost_price_run_lots: manager author attaches lots" on public.cost_price_run_lots;
drop policy if exists "cost_price_run_lots: author attaches lots" on public.cost_price_run_lots;
create policy "cost_price_run_lots: owner/general-manager author attaches"
  on public.cost_price_run_lots for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.is_general_manager()
      and exists (select 1 from public.cost_price_runs r
                  where r.id = cost_price_run_lots.run_id and r.created_by = auth.uid())
    )
  );

drop policy if exists "cost_price_run_lots: manager/owner read" on public.cost_price_run_lots;
drop policy if exists "cost_price_run_lots: read via run" on public.cost_price_run_lots;
create policy "cost_price_run_lots: owner/general-manager read"
  on public.cost_price_run_lots for select to authenticated
  using (public.is_owner() or public.is_general_manager());
