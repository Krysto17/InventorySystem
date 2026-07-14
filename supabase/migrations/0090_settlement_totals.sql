-- ─── Single source of truth for settlement math ─────────────────────────────
-- The net-payable formula (materials − processing fee − other deductions −
-- advances) was re-implemented in ~10 places (JS + SQL). Centralise it in one
-- function that every reader calls, and make the settlement snapshot complete by
-- storing the "other deductions" total so a row reconciles on its own.

alter table public.batch_settlements
  add column if not exists other_deductions_total numeric(14,2) not null default 0;

-- Live breakdown for a visit (used by cards, PDFs, dashboards, and the snapshot).
create or replace function public.settlement_totals(p_visit_id uuid)
  returns table (
    materials numeric,
    processing_fee numeric,
    other_deductions numeric,
    advances numeric,
    net numeric,
    remaining_debt numeric
  )
  language sql stable security definer set search_path = public as $$
  with m as (
    select coalesce(sum(purchase_amount), 0) as materials
    from public.visit_materials where visit_id = p_visit_id and settlement_status = 'settled'
  ), c as (
    select coalesce(sum(amount) filter (where kind = 'light_bill'), 0) as light,
           coalesce(sum(amount) filter (where kind = 'other'), 0) as other
    from public.utility_charges where visit_id = p_visit_id
  ), a as (
    select coalesce(sum(amount), 0) as adv
    from public.advance_deductions where ref_visit_id = p_visit_id
  ), v as (
    select supplier_id from public.visits where id = p_visit_id
  )
  select m.materials, c.light, c.other, a.adv,
         m.materials - c.light - c.other - a.adv,
         public.supplier_outstanding_debt(v.supplier_id)
  from m, c, a, v;
$$;

grant execute on function public.settlement_totals(uuid) to authenticated;

-- approve_pricing snapshots from the single source (and stores other deductions).
create or replace function public.approve_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_state text; v_site uuid; t record;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;

  update public.visit_materials set price_finalized = true where visit_id = p_visit_id;
  update public.visits set state = 'in_accounting' where id = p_visit_id;

  select * into t from public.settlement_totals(p_visit_id);
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  insert into public.batch_settlements
    (visit_id, site_id, materials_total, light_bill_total, other_deductions_total,
     advance_deducted, net_balance, remaining_debt, submitted_by, status, approved_by, approved_at)
  values
    (p_visit_id, v_site, t.materials, t.processing_fee, t.other_deductions,
     t.advances, t.net, t.remaining_debt, auth.uid(), 'approved', auth.uid(), now());
end; $$;

-- Backfill the new column for existing settlements from their visit's charges.
update public.batch_settlements bs
   set other_deductions_total = coalesce((
     select sum(amount) from public.utility_charges uc
     where uc.visit_id = bs.visit_id and uc.kind = 'other'), 0)
 where other_deductions_total = 0;
