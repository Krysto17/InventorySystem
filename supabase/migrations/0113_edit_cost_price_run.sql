-- ─── A computed cost price stays editable until it is sold ──────────────────
-- A saved computation was immutable: its lots and extras had INSERT/SELECT only
-- and the run itself was updatable by the owner (for approval) alone. The owner
-- / general manager can now correct a run after computing it — relabel it, drop
-- a lot, add/edit/remove an external material — and the weighted cost price
-- recomputes automatically. An APPROVED (sold) batch stays locked: it already
-- removed stock and is a completed sale.

-- 1. Edit the run itself (label / material) while it isn't approved.
create policy "cost_price_runs: owner/gm edit unapproved"
  on public.cost_price_runs for update to authenticated
  using (
    (public.is_owner() or public.is_general_manager())
    and approval_status is distinct from 'approved'
  )
  with check (
    (public.is_owner() or public.is_general_manager())
    and approval_status is distinct from 'approved'
  );

-- 2. Drop a stocked lot out of an unapproved run.
create policy "cost_price_run_lots: owner/gm detach unapproved"
  on public.cost_price_run_lots for delete to authenticated
  using (
    (public.is_owner() or public.is_general_manager())
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  );

-- 3. Edit / remove an external material on an unapproved run.
create policy "cost_price_run_extras: owner/gm edit unapproved"
  on public.cost_price_run_extras for update to authenticated
  using (
    (public.is_owner() or public.is_general_manager())
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  )
  with check (public.is_owner() or public.is_general_manager());

create policy "cost_price_run_extras: owner/gm remove unapproved"
  on public.cost_price_run_extras for delete to authenticated
  using (
    (public.is_owner() or public.is_general_manager())
    and exists (
      select 1 from public.cost_price_runs r
      where r.id = run_id and r.approval_status is distinct from 'approved'
    )
  );

-- 4. Recompute the weighted cost on every change, not just on insert.
create or replace function public._cost_price_run_lots_after()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recompute_cost_price_run(coalesce(NEW.run_id, OLD.run_id));
  return coalesce(NEW, OLD);
end; $$;

drop trigger if exists t_cost_price_run_lots_after on public.cost_price_run_lots;
create trigger t_cost_price_run_lots_after
  after insert or delete on public.cost_price_run_lots
  for each row execute function public._cost_price_run_lots_after();

drop trigger if exists t_cost_price_run_extras_after on public.cost_price_run_extras;
create trigger t_cost_price_run_extras_after
  after insert or update or delete on public.cost_price_run_extras
  for each row execute function public._cost_price_run_extras_after();
