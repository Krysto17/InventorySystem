-- ─── One flat read for the stocked-materials log ────────────────────────────
-- The page used to pull every lot with four nested joins (supplier, material,
-- site, and the visit's settlement) and rebuild the shape in JavaScript. That
-- ships a deep JSON tree for every row and, at .limit(1000), was about to start
-- silently dropping lots the way the stock ledger did.
--
-- The view does the joins once, returns flat columns, and carries the store
-- check with it so the log and the check are a single read.
--
-- This one is deliberately NOT security_invoker: the store keeper is walled off
-- suppliers and visits (0126), so an invoker view would return them nothing.
-- Instead the site rule from stock_lots is written out explicitly below — the
-- keeper sees a supplier's NAME against the lot in their store, and none of the
-- bank details that made the table off-limits.

drop view if exists public.stocked_materials;
create view public.stocked_materials as
  select sl.id,
         sl.site_id,
         s.name  as site_name,
         sl.material_type_id,
         mt.name as material_name,
         sup.name          as supplier_name,
         sup.supplier_code as supplier_code,
         sl.weight_kg,
         sl.cost_price_per_kg,
         sl.status,
         sl.created_at,
         -- A lot only exists once its batch was paid; a manual lot has no
         -- settlement behind it, so it has no paid state to report.
         case when vm.id is null then null
              else coalesce(bs.status, 'unpaid') = 'paid'
         end as is_paid,
         sc.status            as check_status,
         sc.counted_weight_kg as counted_weight_kg,
         sc.dispute_note      as dispute_note,
         sc.updated_at        as checked_at,
         p.full_name          as checked_by_name
    from public.stock_lots sl
    join public.sites s            on s.id  = sl.site_id
    join public.material_types mt  on mt.id = sl.material_type_id
    left join public.suppliers sup on sup.id = sl.supplier_id
    left join public.visit_materials vm on vm.id = sl.ref_visit_material_id
    left join public.batch_settlements bs on bs.visit_id = vm.visit_id
    left join public.stock_confirmations sc on sc.stock_lot_id = sl.id
    left join public.profiles p on p.id = sc.checked_by
   where public.is_owner()
      or public.has_cross_site_read()
      or sl.site_id = public.current_site();

comment on view public.stocked_materials is
  'Flat stocked-material log: lot, supplier, paid state and the store check. Site-scoped in the view.';

grant select on public.stocked_materials to authenticated;

-- The log reads newest-first and the joins hang off the source line.
create index if not exists stock_lots_created_at_idx
  on public.stock_lots (created_at desc);
create index if not exists stock_lots_ref_visit_material_idx
  on public.stock_lots (ref_visit_material_id)
  where ref_visit_material_id is not null;
