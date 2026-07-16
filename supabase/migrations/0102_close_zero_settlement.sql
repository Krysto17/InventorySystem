-- ─── A ₦0 (fully-covered) settlement can still be marked paid ────────────────
-- When deductions/advances cancel the whole purchase, the net payable is ₦0 —
-- there's nothing to record through the payment ledger (amounts must be > 0), so
-- the settlement would be stuck in 'approved' and its materials never reach
-- stock. close_settlement lets the owner / manager / accountant mark such a
-- settlement paid (only when nothing is left to pay), which fires stock intake
-- as a normal payment would.

create or replace function public.close_settlement(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_site uuid; v_status text; v_net numeric; v_paid numeric;
begin
  v_role := public.current_role();
  select site_id, status, net_balance into v_site, v_status, v_net
    from public.batch_settlements where id = p_id;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not (public.is_owner() or public.is_general_manager() or public.is_general_accountant()
          or (v_role in ('accounting', 'manager') and v_site = public.current_site())) then
    raise exception 'not allowed to close this settlement';
  end if;
  if v_status not in ('approved', 'partially_paid') then
    raise exception 'this settlement is not open for payment (status: %)', v_status;
  end if;
  v_paid := public.settlement_paid_total(p_id);
  if (v_net - v_paid) > 0.005 then
    raise exception 'this settlement still has %.2f left to pay', (v_net - v_paid);
  end if;
  -- Reuse the ledger transition path (approved/partially_paid → paid), which
  -- stamps paid_by/paid_at and fires stock intake.
  perform set_config('app.ledger_payment', 'on', true);
  update public.batch_settlements set status = 'paid' where id = p_id;
end; $$;

grant execute on function public.close_settlement(uuid) to authenticated;
