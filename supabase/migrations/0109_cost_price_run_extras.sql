-- ─── Mixing batches can include external (non-stock) materials ──────────────
-- A batch may mix in materials that aren't tracked stock lots (e.g. bought
-- outside, or leftover). These "extras" count toward the weighted cost price but
-- are NOT stock, so they're never removed from inventory on sale — only the
-- stocked (paid) lots leave stock.

create table public.cost_price_run_extras (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.cost_price_runs(id) on delete cascade,
  material_name      text not null,
  weight_kg          numeric(14,3) not null check (weight_kg > 0),
  cost_price_per_kg  numeric(14,2) not null default 0 check (cost_price_per_kg >= 0),
  created_at         timestamptz not null default now()
);
create index cost_price_run_extras_run_idx on public.cost_price_run_extras(run_id);

alter table public.cost_price_run_extras enable row level security;
create policy "cost_price_run_extras: owner/gm read"
  on public.cost_price_run_extras for select to authenticated
  using (public.is_owner() or public.is_general_manager());
create policy "cost_price_run_extras: owner/gm insert"
  on public.cost_price_run_extras for insert to authenticated
  with check (public.is_owner() or public.is_general_manager());

-- Shared recompute: weighted totals over BOTH stocked lots and extras.
create or replace function public._recompute_cost_price_run(p_run_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare tot_w numeric; tot_c numeric;
begin
  select coalesce(sum(w), 0), coalesce(sum(c), 0) into tot_w, tot_c from (
    select l.weight_kg as w, l.weight_kg * coalesce(l.cost_price_per_kg, 0) as c
      from public.cost_price_run_lots i join public.stock_lots l on l.id = i.stock_lot_id
      where i.run_id = p_run_id
    union all
    select e.weight_kg, e.weight_kg * coalesce(e.cost_price_per_kg, 0)
      from public.cost_price_run_extras e where e.run_id = p_run_id
  ) x;
  update public.cost_price_runs
     set total_weight_kg = tot_w, total_cost_price = tot_c,
         avg_cost_price_per_kg = case when tot_w > 0 then round(tot_c / tot_w, 2) else null end
   where id = p_run_id;
end; $$;

-- Recompute from lots (now includes extras).
create or replace function public._cost_price_run_lots_after()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recompute_cost_price_run(NEW.run_id);
  return NEW;
end; $$;

-- Recompute when extras change.
create or replace function public._cost_price_run_extras_after()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recompute_cost_price_run(coalesce(NEW.run_id, OLD.run_id));
  return coalesce(NEW, OLD);
end; $$;

create trigger t_cost_price_run_extras_after
  after insert or delete on public.cost_price_run_extras
  for each row execute function public._cost_price_run_extras_after();
