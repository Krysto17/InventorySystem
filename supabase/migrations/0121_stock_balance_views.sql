-- ─── Stock balances are aggregated in the database, not in the page ─────────
-- The dashboards used to fetch every stock_movements row and sum them in
-- JavaScript. PostgREST caps a response at max_rows (1000), silently, so once
-- the ledger passed a thousand rows the totals quietly went wrong — stock that
-- had been sold kept showing as at hand because the movement that removed it
-- was never sent.
--
-- Aggregating in SQL returns one row per bucket instead of one per movement,
-- so the figures cannot drift again as the ledger grows.
--
-- Both views are security_invoker, so a site-scoped role still sees only its
-- own site's stock exactly as it does on the underlying tables.

drop view if exists public.stock_balances;
create view public.stock_balances with (security_invoker = on) as
  select sm.site_id,
         s.name  as site_name,
         sm.material_type_id,
         mt.name as material_name,
         sm.grade,
         sum(case when sm.direction = 'in' then sm.weight else -sm.weight end) as weight_kg
    from public.stock_movements sm
    join public.sites s           on s.id  = sm.site_id
    join public.material_types mt on mt.id = sm.material_type_id
   group by sm.site_id, s.name, sm.material_type_id, mt.name, sm.grade
  having sum(case when sm.direction = 'in' then sm.weight else -sm.weight end) > 0.0005;

comment on view public.stock_balances is
  'Stock at hand per (site, material, grade): sum(in) - sum(out), positive buckets only.';

-- What the stock at hand cost, per material. Built only from lots still in
-- stock, and only from those that carry a price — an uncosted lot must not
-- average in as ₦0/kg. `uncosted_kg` says how much is therefore valued at the
-- material average rather than its own recorded cost.
drop view if exists public.material_cost_basis;
create view public.material_cost_basis with (security_invoker = on) as
  select material_type_id,
         sum(weight_kg * cost_price_per_kg) filter (where cost_price_per_kg > 0)
           / nullif(sum(weight_kg) filter (where cost_price_per_kg > 0), 0) as cost_per_kg,
         coalesce(sum(weight_kg) filter (where coalesce(cost_price_per_kg, 0) <= 0), 0) as uncosted_kg
    from public.stock_lots
   where status = 'available'
   group by material_type_id;

comment on view public.material_cost_basis is
  'Weighted-average purchase cost per kg of the material still at hand.';

grant select on public.stock_balances    to authenticated;
grant select on public.material_cost_basis to authenticated;
