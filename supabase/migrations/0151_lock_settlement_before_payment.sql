-- ─── A payout could be paid more than once, concurrently ────────────────────
-- record_settlement_payment read the settlement, summed what had already been
-- paid, checked the remainder and inserted — without holding the row. Under
-- READ COMMITTED none of the concurrent callers can see an insert the others
-- have not committed yet, so they all read the same "already paid" total, all
-- pass the remaining-balance check, and all insert.
--
-- Reproduced against a local database seeded to match production, five
-- concurrent full-balance payments on a ₦50,000 settlement:
--
--   trial 1: 2 of 5 accepted -> ₦100,000 recorded
--   trial 2: 5 of 5 accepted -> ₦250,000 recorded
--   trial 3: 5 of 5 accepted -> ₦250,000 recorded
--   trial 4: 5 of 5 accepted -> ₦250,000 recorded
--
-- Four trials, four over-payments — up to five times the amount owed, against a
-- supplier who is owed it once. The money leaves the safe before the books are
-- wrong, so it is not recoverable by correcting a row afterwards.
--
-- `for update` is the whole fix. The first caller to reach the settlement holds
-- it until it commits; the others wait, then re-read a total that now includes
-- the first payment and fail the remaining-balance check as they should. The
-- lock is on one settlement row, taken inside a function that already runs as a
-- single statement, so payments to different settlements never contend.
--
-- Everything else is 0150 verbatim: same signature, same role rules (inventory
-- issues cash on its own site and nothing else), same status gate, same insert,
-- same derived status. 0150 is already applied in production and is left alone —
-- migrations are immutable; this replaces the function forward.
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

  -- Hold the settlement for the rest of this call. Everything below — the paid
  -- total, the remaining balance, the insert and the status update — has to see
  -- one consistent view of this payout, and only the lock provides it.
  select site_id, status, net_balance into v_site, v_status, v_net
    from public.batch_settlements where id = p_settlement_id
    for update;
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
    raise exception 'payment % exceeds the remaining balance %',
      to_char(p_amount, 'FM999999999990.00'), to_char(v_net - v_paid, 'FM999999999990.00');
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
