-- ─── Owner approval creates the settlement and sends it to accounting ────────
-- The owner's price approval IS the payment approval. On approval, create the
-- batch settlement as APPROVED (net = materials − processing fee − other
-- deductions − advances) so it goes straight to the accountant's to-pay queue —
-- no separate "submit batch to accounting" step. Deductions are applied before
-- the manager submits the priced batch to the owner.

create or replace function public.approve_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_state text; v_site uuid; v_supplier uuid;
  v_materials numeric; v_light numeric; v_other numeric; v_advance numeric; v_debt numeric;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state, site_id, supplier_id into v_state, v_site, v_supplier
    from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;

  update public.visit_materials set price_finalized = true where visit_id = p_visit_id;
  update public.visits set state = 'in_accounting' where id = p_visit_id;

  select coalesce(sum(purchase_amount), 0) into v_materials
    from public.visit_materials where visit_id = p_visit_id and settlement_status = 'settled';
  select coalesce(sum(amount) filter (where kind = 'light_bill'), 0),
         coalesce(sum(amount) filter (where kind = 'other'), 0)
    into v_light, v_other
    from public.utility_charges where visit_id = p_visit_id;
  select coalesce(sum(amount), 0) into v_advance
    from public.advance_deductions where ref_visit_id = p_visit_id;
  v_debt := public.supplier_outstanding_debt(v_supplier);

  -- Idempotent on re-approval: drop any not-yet-paid settlement first.
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  insert into public.batch_settlements
    (visit_id, site_id, materials_total, light_bill_total, advance_deducted, net_balance,
     remaining_debt, submitted_by, status, approved_by, approved_at)
  values
    (p_visit_id, v_site, v_materials, v_light, v_advance,
     v_materials - v_light - v_other - v_advance, v_debt,
     auth.uid(), 'approved', auth.uid(), now());
end; $$;
