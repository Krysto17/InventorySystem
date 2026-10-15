-- 0165 — Name the supplier without a SECURITY DEFINER view
--
-- 0164 gave the store keeper back the supplier name on their count sheet by
-- routing `stocked_materials` through `supplier_labels`, a three-column view
-- running with owner rights. It worked, but it left the project with the one
-- thing 0141 had just finished removing: a view that bypasses RLS. Supabase's
-- advisor flagged it CRITICAL ("Security Definer View"), and it was the only
-- non-invoker view left in the schema.
--
-- The objection is specific and fair. A definer VIEW is an open door of
-- unknown width: anything that selects from it reads the base table with the
-- owner's rights, and the next person to add a column widens the door without
-- noticing. A definer FUNCTION is a door of fixed width — it returns one value
-- and nothing else — which is why this codebase already uses them everywhere
-- and why the linter does not flag them.
--
-- So the same two fields now come from two small STABLE functions, the view
-- goes back to being a plain invoker view over its own tables, and
-- `supplier_labels` is dropped. The store keeper still reads the name; the
-- wall on `suppliers` (bank account, phone, notes) is still exactly where 0126
-- put it; and the schema has no definer views again.

create or replace function public.supplier_name_of(p_supplier_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select s.name from public.suppliers s where s.id = p_supplier_id
$function$;

create or replace function public.supplier_code_of(p_supplier_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select s.supplier_code from public.suppliers s where s.id = p_supplier_id
$function$;

comment on function public.supplier_name_of(uuid) is
  'A supplier''s name, readable past the store-keeper wall (0126) so a stock '
  'count can say whose sacks it is counting. Returns one column on purpose: '
  'the bank account, phone and notes on that row stay unreachable.';
comment on function public.supplier_code_of(uuid) is
  'A supplier''s business code; see supplier_name_of.';

-- Default privileges hand every new object in `public` to anon as well, and
-- these run with owner rights, so anon is revoked explicitly — the same
-- disclosure 0147 closed and 0164 nearly re-opened.
revoke all on function public.supplier_name_of(uuid) from public, anon;
revoke all on function public.supplier_code_of(uuid) from public, anon;
grant execute on function public.supplier_name_of(uuid) to authenticated;
grant execute on function public.supplier_code_of(uuid) to authenticated;

-- The view again reads only tables the caller may read, and asks the two
-- functions for the supplier's label. Column list, order, types and
-- security_invoker are unchanged from 0164.
create or replace view public.stocked_materials with (security_invoker = on) as
  select sl.id,
    sl.site_id,
    s.name as site_name,
    sl.material_type_id,
    mt.name as material_name,
    public.supplier_name_of(sl.supplier_id) as supplier_name,
    public.supplier_code_of(sl.supplier_id) as supplier_code,
    sl.weight_kg,
    sl.cost_price_per_kg,
    sl.status,
    sl.created_at,
    sl.batch_paid as is_paid,
    sc.status as check_status,
    sc.counted_weight_kg,
    sc.dispute_note,
    sc.updated_at as checked_at,
    p.full_name as checked_by_name
   from public.stock_lots sl
     join public.sites s on s.id = sl.site_id
     join public.material_types mt on mt.id = sl.material_type_id
     left join public.stock_confirmations sc on sc.stock_lot_id = sl.id
     left join public.profiles p on p.id = sc.checked_by;

drop view if exists public.supplier_labels;
