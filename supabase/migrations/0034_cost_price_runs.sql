-- ─── Phase 11 (F): Cost-price dashboard ──────────────────────────────────────
-- Ad-hoc weighted cost-price computation over stock lots (the blueprint's
-- "select material batches, combine materials, generate weighted cost price,
-- save mixed batch records, retrieve historical cost prices"). Unlike a lot
-- SALE, a run sells nothing — it's a saved calculation with provenance.
-- Access: manager / accountant / owner.

create table public.cost_price_runs (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references public.sites(id),
  label                 text not null,
  total_weight_kg       numeric(12,3) not null default 0,
  total_cost_price      numeric(14,2) not null default 0,
  avg_cost_price_per_kg numeric(12,2),
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

create table public.cost_price_run_lots (
  run_id       uuid not null references public.cost_price_runs(id) on delete cascade,
  stock_lot_id uuid not null references public.stock_lots(id),
  primary key (run_id, stock_lot_id)
);

-- Recompute the parent run's snapshot whenever lots are attached.
create or replace function public._cost_price_run_lots_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  tot_w numeric;
  tot_c numeric;
begin
  select coalesce(sum(l.weight_kg), 0),
         coalesce(sum(l.weight_kg * coalesce(l.cost_price_per_kg, 0)), 0)
    into tot_w, tot_c
    from public.cost_price_run_lots i
    join public.stock_lots l on l.id = i.stock_lot_id
   where i.run_id = NEW.run_id;

  update public.cost_price_runs
     set total_weight_kg       = tot_w,
         total_cost_price      = tot_c,
         avg_cost_price_per_kg = case when tot_w > 0 then round(tot_c / tot_w, 2) else null end
   where id = NEW.run_id;
  return NEW;
end;
$$;

create trigger t_cost_price_run_lots_after
  after insert on public.cost_price_run_lots
  for each row execute function public._cost_price_run_lots_after();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.cost_price_runs     enable row level security;
alter table public.cost_price_run_lots enable row level security;

create policy "cost_price_runs: read own site or cross-site reporter"
  on public.cost_price_runs for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

create policy "cost_price_runs: manager/accounting insert own site"
  on public.cost_price_runs for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and site_id = public.current_site()
    )
  );

create policy "cost_price_run_lots: read via run"
  on public.cost_price_run_lots for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.cost_price_runs r
               where r.id = cost_price_run_lots.run_id and r.site_id = public.current_site())
  );

create policy "cost_price_run_lots: author attaches lots"
  on public.cost_price_run_lots for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and exists (select 1 from public.cost_price_runs r
                  where r.id = cost_price_run_lots.run_id
                    and r.created_by = auth.uid())
    )
  );
