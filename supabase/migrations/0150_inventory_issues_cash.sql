-- ─── The inventory employee issues the cash ─────────────────────────────────
-- Part payments to a supplier are often handed over as PHYSICAL CASH, and the
-- person who counts it out of the safe is the inventory employee — not the
-- accountant (who moves money by transfer) and not always the manager.
--
-- The approval chain is unchanged and still comes first: the manager prices and
-- submits the batch, the OWNER approves the settlement. Only then is it
-- 'approved' / 'partially_paid' and open for payment. What changes here is who
-- may record a disbursement against it:
--
--   accounting / manager / owner …  any method (cash, transfer, other)
--   inventory (own site) ……………………  CASH ONLY
--
-- Inventory hands over cash; it does not move money between accounts. Everything
-- else the RPC already enforces — the settlement must be open, and a payment may
-- never exceed the remaining balance — applies to them unchanged.

create or replace function public.record_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_method text,
  p_note text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_bank_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text; v_site uuid; v_status text; v_net numeric; v_paid numeric; v_id uuid;
begin
  v_role := public.current_role();
  if p_method not in ('cash', 'transfer', 'other') then
    raise exception 'unknown payment method';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be greater than zero';
  end if;

  select site_id, status, net_balance into v_site, v_status, v_net
    from public.batch_settlements where id = p_settlement_id;
  if v_site is null then raise exception 'settlement not found'; end if;

  -- The inventory employee issues cash on their own site, and nothing else.
  if v_role = 'inventory' and not public.is_owner() then
    if v_site is distinct from public.current_site() then
      raise exception 'not allowed to record a payment for this settlement';
    end if;
    if p_method <> 'cash' then
      raise exception 'inventory can only issue cash — a transfer is recorded by accounting';
    end if;
  elsif not (public.is_owner() or public.is_general_manager() or public.is_general_accountant()
             or (v_role in ('accounting', 'manager') and v_site = public.current_site())) then
    raise exception 'not allowed to record a payment for this settlement';
  end if;

  if v_status not in ('approved', 'partially_paid') then
    raise exception 'this settlement is not open for payment (status: %)', v_status;
  end if;

  v_paid := public.settlement_paid_total(p_settlement_id);
  if p_amount > (v_net - v_paid) + 0.005 then
    raise exception 'payment %.2f exceeds the remaining balance %.2f', p_amount, (v_net - v_paid);
  end if;

  insert into public.settlement_payments
    (settlement_id, site_id, amount, method, note, paid_by, account_name, account_number, bank_name)
  values
    (p_settlement_id, v_site, p_amount, p_method, nullif(btrim(p_note), ''), auth.uid(),
     nullif(btrim(p_account_name), ''), nullif(btrim(p_account_number), ''), nullif(btrim(p_bank_name), ''))
  returning id into v_id;

  -- Recompute the derived status (ledger-driven; bypasses the role checks).
  perform set_config('app.ledger_payment', 'on', true);
  if (v_paid + p_amount) >= v_net - 0.005 then
    update public.batch_settlements set status = 'paid' where id = p_settlement_id;
  else
    update public.batch_settlements set status = 'partially_paid' where id = p_settlement_id;
  end if;

  return v_id;
end; $$;

grant execute on function public.record_settlement_payment(uuid, numeric, text, text, text, text, text) to authenticated;
