-- ─── The analyses screen reads flat, and searches in Postgres ───────────────
-- The screen fetched every XRF record ever taken, with the material, supplier,
-- site and visit hanging off it as nested JSON, then searched and filtered the
-- lot in the browser. It gains a row per material line, forever.
--
-- Flat columns mean the search is a plain `or` over this view and the page only
-- ever holds the matches. security_invoker keeps the existing rule: QC and the
-- owner see all, a site manager sees their own site.

drop view if exists public.xrf_analyses;
create view public.xrf_analyses with (security_invoker = on) as
  select x.id,
         vm.id            as line_id,
         v.id             as visit_id,
         coalesce(x.updated_at, x.created_at) as recorded_at,
         sup.name         as supplier_name,
         s.name           as site_name,
         mt.name          as material_name,
         x.result,
         x.weight_kg      as qc_weight_kg,
         vm.unit_price,
         vm.price_agreed,
         vm.settlement_status,
         vm.unsettled_reason,
         v.state          as visit_state,
         (
           select gp.id from public.gate_passes gp
            where gp.visit_material_id = vm.id and gp.status <> 'cancelled'
            limit 1
         ) as gate_pass_id
    from public.xrf_records x
    join public.visit_materials vm on vm.id = x.visit_material_id
    join public.visits v           on v.id = vm.visit_id
    left join public.suppliers sup on sup.id = v.supplier_id
    left join public.sites s       on s.id = v.site_id
    left join public.material_types mt on mt.id = vm.material_type_id;

comment on view public.xrf_analyses is
  'Flat XRF analyses for the analyses screens: line, supplier, material, price and release state.';

grant select on public.xrf_analyses to authenticated;
