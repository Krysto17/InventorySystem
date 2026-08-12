-- ─── The supply pipeline in one read ────────────────────────────────────────
-- The panel on every role's home read 100 visits with three nested joins, then
-- ran two more queries across all 100 ids to learn which had an owner-finalised
-- price and which had lines withdrawn. Three round-trips and a deep JSON tree
-- to draw ten rows.
--
-- security_invoker, so a visit still only appears to someone whose RLS policy
-- on `visits` lets them see it.

drop view if exists public.visit_pipeline;
create view public.visit_pipeline with (security_invoker = on) as
  select v.id,
         v.state,
         v.entry_path,
         v.created_at,
         v.site_id,
         s.name   as site_name,
         sup.name as supplier_name,
         mt.name  as material_name,
         exists (
           select 1 from public.visit_materials m
            where m.visit_id = v.id and m.price_finalized
         ) as price_approved,
         (
           select count(*) from public.visit_materials m
            where m.visit_id = v.id and m.settlement_status = 'unsettled'
         ) as unsettled_count
    from public.visits v
    left join public.sites s          on s.id  = v.site_id
    left join public.suppliers sup    on sup.id = v.supplier_id
    left join public.material_types mt on mt.id = v.declared_material_type_id;

comment on view public.visit_pipeline is
  'Supply pipeline rows for the live workflow panel: visit, supplier, material, and its price/withdrawn flags.';

grant select on public.visit_pipeline to authenticated;
