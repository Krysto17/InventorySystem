-- ─── Two views were SECURITY DEFINER; make them run as the caller ───────────
-- A definer view runs with its owner's rights, so RLS on the underlying tables
-- is bypassed and the view itself becomes the only thing standing between a
-- caller and every row. Supabase's linter flags it, and rightly: the security
-- boundary in this app is RLS, not a WHERE clause someone might edit later.
--
-- `site_rollups` flips over cleanly — everyone who reads it (owner, general
-- manager, general accountant) already has cross-site read on its sources.
--
-- `stocked_materials` could not, and that is why it was written this way: the
-- store keeper is deliberately walled off suppliers, visit_materials and
-- batch_settlements (0126), so as an invoker view its `is_paid` would come back
-- null for them and nothing in their own store would be countable. The paid
-- state therefore moves onto the lot itself, where the keeper can read it.

-- ── 1. The lot carries its own paid state ───────────────────────────────────
alter table public.stock_lots
  add column if not exists batch_paid boolean;

comment on column public.stock_lots.batch_paid is
  'Was the batch behind this lot paid for? NULL for a manual lot with no settlement behind it.';

create or replace function public._stock_lots_set_batch_paid()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.ref_visit_material_id is null then
    NEW.batch_paid := null;               -- manual lot: no settlement to be paid
  else
    select coalesce(bs.status, 'unpaid') = 'paid'
      into NEW.batch_paid
      from public.visit_materials vm
      left join public.batch_settlements bs on bs.visit_id = vm.visit_id
     where vm.id = NEW.ref_visit_material_id;
    NEW.batch_paid := coalesce(NEW.batch_paid, false);
  end if;
  return NEW;
end; $$;

drop trigger if exists t_stock_lots_batch_paid on public.stock_lots;
create trigger t_stock_lots_batch_paid
  before insert on public.stock_lots
  for each row execute function public._stock_lots_set_batch_paid();

-- A settlement reversed after stocking leaves lots the company no longer owns
-- paid for; keep the flag honest rather than frozen at intake.
create or replace function public._batch_settlements_sync_lot_paid()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status is distinct from OLD.status then
    update public.stock_lots sl
       set batch_paid = (NEW.status = 'paid')
      from public.visit_materials vm
     where vm.id = sl.ref_visit_material_id
       and vm.visit_id = NEW.visit_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists t_batch_settlements_sync_lot_paid on public.batch_settlements;
create trigger t_batch_settlements_sync_lot_paid
  after update on public.batch_settlements
  for each row execute function public._batch_settlements_sync_lot_paid();

update public.stock_lots sl
   set batch_paid = case
         when sl.ref_visit_material_id is null then null
         else coalesce((
           select bs.status = 'paid'
             from public.visit_materials vm
             left join public.batch_settlements bs on bs.visit_id = vm.visit_id
            where vm.id = sl.ref_visit_material_id
         ), false)
       end
 where sl.batch_paid is distinct from case
         when sl.ref_visit_material_id is null then null
         else coalesce((
           select bs.status = 'paid'
             from public.visit_materials vm
             left join public.batch_settlements bs on bs.visit_id = vm.visit_id
            where vm.id = sl.ref_visit_material_id
         ), false)
       end;

-- ── 2. stocked_materials, now as the caller ─────────────────────────────────
-- Only `suppliers` is still out of the keeper's reach, and it is a LEFT JOIN:
-- they see the lot with a blank supplier, which is exactly what their screen
-- already showed. Every other role sees the name as before.
drop view if exists public.stocked_materials;
create view public.stocked_materials with (security_invoker = on) as
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
         sl.batch_paid as is_paid,
         sc.status            as check_status,
         sc.counted_weight_kg as counted_weight_kg,
         sc.dispute_note      as dispute_note,
         sc.updated_at        as checked_at,
         p.full_name          as checked_by_name
    from public.stock_lots sl
    join public.sites s            on s.id  = sl.site_id
    join public.material_types mt  on mt.id = sl.material_type_id
    left join public.suppliers sup on sup.id = sl.supplier_id
    left join public.stock_confirmations sc on sc.stock_lot_id = sl.id
    left join public.profiles p on p.id = sc.checked_by;

comment on view public.stocked_materials is
  'Flat stocked-material log: lot, supplier, paid state and the store check. Runs as the caller.';

grant select on public.stocked_materials to authenticated;

-- ── 3. site_rollups, now as the caller ──────────────────────────────────────
-- The guard stays as well as RLS: this panel is cross-site by definition, and a
-- site-scoped caller should get nothing rather than a partial picture that
-- reads like the whole company.
drop view if exists public.site_rollups;
create view public.site_rollups with (security_invoker = on) as
  select s.id as site_id,
         s.name as site_name,
         coalesce(l.available_kg, 0)      as available_lot_kg,
         coalesce(l.lot_value, 0)         as lot_value,
         coalesce(a.pending_advances, 0)  as pending_advances,
         coalesce(p.fee_in, 0)            as fee_in,
         coalesce(p.paid_out, 0)          as paid_out
    from public.sites s
    left join (
      select site_id,
             sum(weight_kg) as available_kg,
             sum(weight_kg * coalesce(cost_price_per_kg, 0)) as lot_value
        from public.stock_lots where status = 'available' group by site_id
    ) l on l.site_id = s.id
    left join (
      select site_id, sum(amount_naira) as pending_advances
        from public.advances where approval_status = 'pending' group by site_id
    ) a on a.site_id = s.id
    left join (
      select v.site_id,
             sum(pm.amount) filter (where pm.direction <> 'purchase_amount_out') as fee_in,
             sum(pm.amount) filter (where pm.direction =  'purchase_amount_out') as paid_out
        from public.payments pm join public.visits v on v.id = pm.visit_id
       group by v.site_id
    ) p on p.site_id = s.id
   where public.is_owner() or public.has_cross_site_read();

comment on view public.site_rollups is
  'Per-site stock and money totals for the cross-site report. Runs as the caller.';

grant select on public.site_rollups to authenticated;

-- ── 4. Expense totals for the whole filtered set, not just the page ─────────
-- The list is capped, so summing the rows on screen would understate the total
-- the moment the cap is reached. Same filters, counted in Postgres, RLS-scoped
-- to what the caller may read.
create or replace function public.expense_totals(
  p_status text default null,
  p_q      text default null
)
returns table (
  entries         bigint,
  total_naira     numeric,
  pending_naira   numeric,
  approved_naira  numeric,
  paid_naira      numeric
)
language sql stable security invoker set search_path = public as $$
  select count(*)::bigint,
         coalesce(sum(amount_naira), 0),
         coalesce(sum(amount_naira) filter (where approval_status = 'pending'), 0),
         coalesce(sum(amount_naira) filter (where approval_status = 'approved'), 0),
         coalesce(sum(amount_naira) filter (where approval_status = 'paid'), 0)
    from public.consumables c
   where (nullif(btrim(coalesce(p_status, '')), '') is null
          or c.approval_status = p_status)
     and (nullif(btrim(coalesce(p_q, '')), '') is null
          or c.name ilike '%' || p_q || '%'
          or c.comment ilike '%' || p_q || '%'
          or c.category ilike '%' || p_q || '%'
          or c.account_name ilike '%' || p_q || '%');
$$;

grant execute on function public.expense_totals(text, text) to authenticated;
