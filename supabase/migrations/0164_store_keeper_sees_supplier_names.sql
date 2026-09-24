-- 0164 — The store keeper can read a supplier's NAME again
--
-- The store-check sheet exists to let whoever counts the store tick material
-- off against what the books claim: supplier, material, weight, paid state.
-- For the store keeper the supplier column has been blank.
--
-- Why. 0141 turned `stocked_materials` into a security_invoker view so that RLS
-- — not the view's WHERE clause — is the boundary. That migration saw the
-- consequence for `is_paid` and solved it by moving the paid flag onto the lot,
-- where the keeper can read it. The supplier columns have exactly the same
-- shape and were missed: 0126 walls the keeper off `suppliers` with a
-- RESTRICTIVE policy, so under invoker rights the view's LEFT JOIN matches no
-- supplier row and `supplier_name` / `supplier_code` come back NULL. Proved on
-- LOCAL against one lot: the manager reads "Ahmed Musa / SUP-MJZ-9042", the
-- keeper reads NULL for the same row, and `select count(*) from suppliers`
-- returns 164 for the manager and 0 for the keeper.
--
-- The fix, and its limits. The wall around `suppliers` is deliberate and stays:
-- that table carries the supplier's bank account name, account number, bank,
-- former accounts, phone and notes, and a stock count is no reason to see any
-- of it. What the count sheet needs is the name on the sack. So this adds a
-- view that exposes THREE columns and nothing else, and points
-- `stocked_materials` at it. The keeper gains the supplier's name and code;
-- every other column of `suppliers` remains as unreachable as before.
--
-- `supplier_labels` is deliberately NOT security_invoker — that is the whole
-- mechanism. It runs with its owner's rights, so it can resolve the name past
-- the restrictive policy, and because it selects only three columns there is
-- nothing else for it to leak. Every other role could already read supplier
-- names directly, so this widens nothing for them.

create or replace view public.supplier_labels as
  select id, name, supplier_code
    from public.suppliers;

comment on view public.supplier_labels is
  'Supplier name + code only, readable past the store-keeper wall (0126). '
  'Owner rights on purpose: it exists so a stock count can name its supplier '
  'without exposing phone, notes or bank details. Do not add columns to it.';

grant select on public.supplier_labels to authenticated;

-- Re-emitted from the 0154 body. The only change is the supplier join, which
-- now reads the label view instead of the walled table; the column list, its
-- order and types, and security_invoker are all unchanged.
create or replace view public.stocked_materials with (security_invoker = on) as
  select sl.id,
    sl.site_id,
    s.name as site_name,
    sl.material_type_id,
    mt.name as material_name,
    sup.name as supplier_name,
    sup.supplier_code,
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
     left join public.supplier_labels sup on sup.id = sl.supplier_id
     left join public.stock_confirmations sc on sc.stock_lot_id = sl.id
     left join public.profiles p on p.id = sc.checked_by;
