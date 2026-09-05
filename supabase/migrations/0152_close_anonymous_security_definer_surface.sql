-- ─── C1: unauthenticated callers reached privileged SECURITY DEFINER logic ───
-- Every guard below is written `if not (<expr>) then raise`. When auth.uid() is
-- NULL the role/site comparisons inside <expr> are NULL, not false, so <expr>
-- is NULL, `not NULL` is NULL, and plpgsql does not take an IF branch on NULL.
-- The exception was skipped and execution continued into the write, running as
-- postgres and bypassing RLS.
--
-- Measured on production before this migration:
--     auth.uid() = null, current_role() = null, is_owner() = false,
--     _can_review_payable(...) = NULL   <- not false
--
-- Reachability was confirmed the same way: an anon caller (no JWT, public anon
-- key) reached record_settlement_payment, delete_supplier, release_settlement
-- and send_settlement_back, each stopping only at 'not found' for a nonexistent
-- id -- i.e. past the authorization point. A correctly guarded function
-- (approve_pricing, `if not public.is_owner()`) answered the same probe with
-- 'only the owner can approve pricing'.
--
-- Two layers, in this order of importance:
--
--   1. ACL. anon and PUBLIC lose EXECUTE on all 28 affected functions. This is
--      the boundary: these are staff operations invoked from server actions
--      with a user JWT, and no migration, trigger or other database function
--      calls any of them (verified -- the one mention of authorize_gate_pass
--      inside _gate_passes_transition is a comment). All 102 SECURITY DEFINER
--      functions are owned by postgres, so a SECURITY DEFINER caller keeps
--      EXECUTE regardless of what PUBLIC holds.
--
--   2. Fail-closed guards. coalesce(<expr>, false) so a NULL guard rejects
--      instead of falling through. Defence in depth: it survives a future
--      re-grant. coalesce can only make a guard more restrictive, never less,
--      so no authorized caller changes behaviour -- for them <expr> was already
--      true or false.
--
-- 0147 did this for 8 functions and taught the lesson repeated here: revoking
-- from PUBLIC also strips authenticated and service_role, because that is where
-- their access came from. Every function below is therefore re-granted
-- explicitly. service_role is kept because it held EXECUTE before this
-- migration and the key is server-only; nothing about C1 depends on removing it.
--
-- Bodies are restated verbatim from the live definitions, which were verified
-- byte-identical to their newest defining migration in this repository (20/20,
-- zero drift). The ONLY change to each is the coalesce() around the guard.
-- 0147-0151 are untouched; record_settlement_payment keeps its 0151 `for update`.

-- ── 1. The shared payable-review predicate ───────────────────────────────
-- Fixing this one function closes the guard in all nine hold/release/send-back
-- functions -- hold_advance, hold_expense, hold_settlement, release_advance,
-- release_expense, release_settlement, send_advance_back, send_expense_back
-- and send_settlement_back -- none of which needs a body change as a result.

CREATE OR REPLACE FUNCTION public._can_review_payable(p_site uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.is_owner()
      or public.is_general_manager()
      or public.is_general_accountant()
      or (public.current_role() in ('manager', 'accounting') and p_site = public.current_site()), false);
$function$;

-- ── 2. Functions carrying their own inline guard ─────────────────────────

CREATE OR REPLACE FUNCTION public.accountant_send_back_to_owner(p_visit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_site uuid; v_settle text;
begin
  if not coalesce((public.current_role() = 'accounting' or public.is_owner()), false) then
    raise exception 'only accounting may send a batch back for review';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason for the review is required';
  end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'in_accounting' then
    raise exception 'only a batch sitting in accounting can be sent back';
  end if;
  if not coalesce((public.is_owner() or public.is_general_accountant() or v_site = public.current_site()), false) then
    raise exception 'no access to this site';
  end if;

  select status into v_settle from public.batch_settlements
    where visit_id = p_visit_id order by created_at desc limit 1;
  if v_settle = 'paid' then
    raise exception 'this batch is already paid — record a price correction instead';
  end if;

  -- Void the approved settlement + unlock line prices, restoring the normal
  -- 'awaiting_price_approval' state (priced, not yet finalized). The owner then
  -- re-approves or sends it on to the manager.
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  perform set_config('app.allow_price_unlock', 'on', true); -- transaction-local
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  update public.visits set state = 'awaiting_price_approval' where id = p_visit_id;

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site,
          '↩︎ Returned by accounting for the owner to review: ' || btrim(p_reason),
          auth.uid());
end; $function$;

CREATE OR REPLACE FUNCTION public.approve_visit_by_manager(p_visit_id uuid, p_skip_qc boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to approve this visit';
  end if;
  if v_state <> 'awaiting_manager' then raise exception 'visit is not awaiting manager approval'; end if;

  if p_skip_qc then
    -- An explicit waiver by the manager: no analysis, no QC weigh, straight to
    -- pricing. Marking the lines exempt keeps the pricing-entry invariant true.
    update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
    update public.visits set state = 'pricing' where id = p_visit_id;
    return;
  end if;

  update public.visits set state = 'in_qc' where id = p_visit_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.authorize_gate_pass(p_pass_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_status text;
begin
  select site_id, status into v_site, v_status from public.gate_passes where id = p_pass_id;
  if v_site is null then raise exception 'gate pass not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'only the manager or owner can authorize a gate pass';
  end if;
  if v_status <> 'pending' then
    raise exception 'only a pending gate pass can be authorized (status: %)', v_status;
  end if;
  update public.gate_passes
     set status = 'issued', authorized_by = auth.uid(), authorized_at = now()
   where id = p_pass_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.close_dressing_only(p_visit_id uuid, p_carry boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_site uuid; v_role text; v_has_bill boolean;
begin
  v_role := public.current_role();
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or (v_role in ('processing', 'manager') and v_site = public.current_site())), false) then
    raise exception 'not allowed to close this visit';
  end if;
  if v_state not in ('in_receiving', 'pricing') then
    raise exception 'a dressing-only close applies after processing, before supply (state: %)', v_state;
  end if;
  if exists (select 1 from public.batch_settlements where visit_id = p_visit_id) then
    raise exception 'this visit already has a settlement';
  end if;
  select exists (select 1 from public.utility_charges where visit_id = p_visit_id and kind = 'light_bill')
    into v_has_bill;
  if not v_has_bill then raise exception 'record the light bill before closing as dressing-only'; end if;

  -- Carry the light bill to the customer's account, or (cash) leave it settled.
  update public.utility_charges set carried = coalesce(p_carry, true)
    where visit_id = p_visit_id and kind = 'light_bill';
  update public.visits set dressing_only = true, state = 'exited' where id = p_visit_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.close_settlement(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text; v_site uuid; v_status text; v_net numeric; v_paid numeric;
begin
  v_role := public.current_role();
  select site_id, status, net_balance into v_site, v_status, v_net
    from public.batch_settlements where id = p_id;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager() or public.is_general_accountant()
          or (v_role in ('accounting', 'manager') and v_site = public.current_site())), false) then
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
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_supplier(p_supplier_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce((public.is_owner() or public.current_role() = 'manager'), false) then
    raise exception 'not authorized to delete suppliers';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier not found';
  end if;
  begin
    delete from public.suppliers where id = p_supplier_id;
  exception when foreign_key_violation then
    raise exception 'This supplier has records and cannot be deleted.';
  end;
end; $function$;

CREATE OR REPLACE FUNCTION public.manager_skip_to_pricing(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to skip analysis for this visit';
  end if;
  if v_state <> 'in_qc' then raise exception 'visit is not in analysis'; end if;
  update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
  update public.visits set state = 'pricing' where id = p_visit_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.mark_price_correction_paid(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dir text; v_paid timestamptz; v_site uuid;
begin
  if public.current_role() <> 'accounting' then
    raise exception 'only accounting may mark a compensation paid';
  end if;
  select direction, paid_at, site_id into v_dir, v_paid, v_site
    from public.price_corrections where id = p_id;
  if v_dir is null then raise exception 'correction not found'; end if;
  if v_dir <> 'underpaid' then
    raise exception 'only an underpaid correction is a payable';
  end if;
  if v_paid is not null then raise exception 'already paid'; end if;
  -- An accountant pays their own site; the general accountant pays any site.
  if not coalesce((v_site = public.current_site() or public.is_general_accountant()), false) then
    raise exception 'no access to this site';
  end if;
  update public.price_corrections
    set paid_by = auth.uid(), paid_at = now()
    where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.record_debt_repayment(p_supplier_id uuid, p_amount numeric, p_note text DEFAULT NULL::text, p_kind text DEFAULT 'advance'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_id uuid; v_role text;
begin
  v_role := public.current_role();
  if not coalesce((public.is_owner() or v_role in ('manager', 'accounting')), false) then
    raise exception 'not allowed to record a repayment';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'repayment amount must be greater than zero';
  end if;
  if p_kind not in ('advance', 'processing') then
    raise exception 'unknown debt kind';
  end if;

  v_site := public.current_site();
  if v_site is null then
    select site_id into v_site from public.visits
      where supplier_id = p_supplier_id order by created_at desc limit 1;
  end if;
  if v_site is null then
    select id into v_site from public.sites order by created_at limit 1;
  end if;

  insert into public.advance_deductions (supplier_id, site_id, ref_visit_id, amount, notes, recorded_by, kind)
  values (
    p_supplier_id, v_site, null, p_amount,
    coalesce(nullif(btrim(p_note), ''), case when p_kind = 'processing'
      then 'Processing fee repayment — paid outside the app'
      else 'Repayment — paid outside the app' end),
    auth.uid(), p_kind
  )
  returning id into v_id;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.record_settlement_payment(p_settlement_id uuid, p_amount numeric, p_method text, p_note text DEFAULT NULL::text, p_account_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  elsif not coalesce((public.is_owner() or public.is_general_manager() or public.is_general_accountant()
             or (v_role in ('accounting', 'manager') and v_site = public.current_site())), false) then
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
end; $function$;

CREATE OR REPLACE FUNCTION public.record_stock_check(p_lot_id uuid, p_status text, p_counted_weight numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_settlement text; v_has_source boolean;
begin
  select sl.site_id,
         vm.id is not null,
         bs.status
    into v_site, v_has_source, v_settlement
    from public.stock_lots sl
    left join public.visit_materials vm on vm.id = sl.ref_visit_material_id
    left join public.batch_settlements bs on bs.visit_id = vm.visit_id
   where sl.id = p_lot_id and sl.status = 'available';

  if v_site is null then raise exception 'that lot is not in stock'; end if;
  if not coalesce((public.is_owner()
          or (public.current_role()::text in ('stock_keeper', 'manager')
              and v_site = public.current_site())), false) then
    raise exception 'only the store keeper or the site manager can check their own store';
  end if;
  if p_status not in ('confirmed', 'disputed') then
    raise exception 'a lot is either confirmed or disputed';
  end if;
  if v_has_source and coalesce(v_settlement, 'unpaid') <> 'paid' then
    raise exception 'this material has not been paid for yet';
  end if;

  insert into public.stock_confirmations
    (stock_lot_id, site_id, status, counted_weight_kg, dispute_note, checked_by)
  values
    (p_lot_id, v_site, p_status, p_counted_weight, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (stock_lot_id) do update
    set status            = excluded.status,
        counted_weight_kg = excluded.counted_weight_kg,
        dispute_note      = excluded.dispute_note,
        checked_by        = excluded.checked_by,
        updated_at        = now();
end; $function$;

CREATE OR REPLACE FUNCTION public.remove_line(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visit uuid; v_site uuid;
begin
  select vm.visit_id, v.site_id into v_visit, v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to remove this line';
  end if;
  delete from public.visit_materials where id = p_line_id;
  update public.pricing set unit_price = unit_price where visit_id = v_visit;
end; $function$;

CREATE OR REPLACE FUNCTION public.reopen_processing_fee(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text; v_rec uuid;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to send the processing fee back';
  end if;
  if v_state in ('exited', 'stocked') then raise exception 'visit is closed'; end if;
  select id into v_rec from public.processing_records where visit_id = p_visit_id order by created_at desc limit 1;
  if v_rec is null then raise exception 'no processing record to reopen'; end if;
  update public.processing_records set fee_reopened = true where id = v_rec;
end; $function$;

CREATE OR REPLACE FUNCTION public.reopen_receiving(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() in ('receiving', 'manager') and v_site = public.current_site())), false) then
    raise exception 'not authorized to reopen receiving on this visit';
  end if;
  if v_state <> 'in_qc' then
    raise exception 'only a batch waiting in QC can be reopened for receiving (state: %)', v_state;
  end if;
  update public.visits set state = 'in_receiving' where id = p_visit_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.resettle_line(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid;
begin
  select v.site_id into v_site
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_site is null then raise exception 'line not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to re-settle this line';
  end if;
  update public.visit_materials set settlement_status = 'settled', unsettled_reason = null where id = p_line_id;
  update public.gate_passes set status = 'cancelled' where visit_material_id = p_line_id and status <> 'cancelled';
end; $function$;

CREATE OR REPLACE FUNCTION public.reverse_paid_supply(p_visit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_settle uuid; v_status text; v_site uuid;
begin
  if not coalesce((public.current_role() = 'accounting' or public.is_owner()), false) then
    raise exception 'only accounting may reverse a paid supply';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason (refund confirmation) is required'; end if;

  select id, status, site_id into v_settle, v_status, v_site
    from public.batch_settlements where visit_id = p_visit_id;
  if v_settle is null then raise exception 'no settlement to reverse'; end if;
  if v_status <> 'paid' then raise exception 'only a paid supply can be reversed'; end if;
  if not coalesce((public.is_owner() or public.is_general_accountant() or v_site = public.current_site()), false) then
    raise exception 'no access to this site';
  end if;

  -- The intake lots must still be fully in stock and unused.
  if exists (
    select 1 from public.stock_lots sl
    join public.visit_materials vm on vm.id = sl.ref_visit_material_id
    where vm.visit_id = p_visit_id and (
      sl.status <> 'available'
      or exists (select 1 from public.cost_price_run_lots x where x.stock_lot_id = sl.id)
      or exists (select 1 from public.lot_sale_items x where x.stock_lot_id = sl.id)
      or exists (select 1 from public.gate_passes x where x.stock_lot_id = sl.id)
    )
  ) then
    raise exception 'cannot reverse — some of this material has already left stock (sold, mixed, or gate-passed)';
  end if;

  -- Roll the intake back out of stock.
  delete from public.stock_movements
    where ref_visit_id = p_visit_id and reason = 'purchase_intake' and direction = 'in';
  delete from public.stock_lots
    where ref_visit_material_id in (select id from public.visit_materials where visit_id = p_visit_id);

  -- Void the payment + settlement.
  delete from public.settlement_payments where settlement_id = v_settle;
  delete from public.batch_settlements where id = v_settle;

  -- Reopen for re-settlement at pricing.
  perform set_config('app.allow_price_unlock', 'on', true);
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  update public.pricing set agreement_status = 'pending' where visit_id = p_visit_id;
  update public.visits set state = 'pricing', dressing_only = false, closed_at = null where id = p_visit_id;

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site, '↩︎ Paid supply reversed (supplier refund confirmed): ' || btrim(p_reason), auth.uid());
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_visit_to_manager(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text; n_total int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'receiving' and v_site = public.current_site())), false) then
    raise exception 'not authorized to submit this visit';
  end if;
  if v_state <> 'in_receiving' then raise exception 'visit is not in receiving'; end if;
  select count(*) into n_total from public.visit_materials where visit_id = p_visit_id;
  if n_total = 0 then raise exception 'cannot submit without material lines'; end if;
  -- Every batch is weighed by QC, whether or not any line needs an XRF.
  update public.visits set state = 'in_qc' where id = p_visit_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.sync_processing_fee(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_rec_id uuid; v_discount numeric; v_gross numeric; v_fee numeric; v_desc text;
begin
  select site_id into v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner()
          or (public.current_role() in ('processing', 'manager') and v_site = public.current_site())), false) then
    raise exception 'not authorized';
  end if;
  select id, coalesce(discount_percent, 0) into v_rec_id, v_discount
    from public.processing_records where visit_id = p_visit_id order by created_at desc limit 1;
  if v_rec_id is null then return; end if;
  select coalesce(sum(measurement * rate_snapshot), 0) into v_gross
    from public.processing_machine_usage where processing_record_id = v_rec_id;
  v_fee := v_gross * (1 - v_discount / 100.0);
  v_desc := case when v_discount > 0 then 'Processing fee (' || v_discount || '% discount)' else 'Processing fee' end;
  if exists (select 1 from public.utility_charges where visit_id = p_visit_id and kind = 'light_bill') then
    update public.utility_charges set amount = v_fee, description = v_desc
      where visit_id = p_visit_id and kind = 'light_bill';
  elsif v_fee > 0 then
    insert into public.utility_charges (visit_id, kind, description, amount, recorded_by)
    values (p_visit_id, 'light_bill', v_desc, v_fee, auth.uid());
  end if;
  update public.processing_records set fee_reopened = false where id = v_rec_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.unsettle_line(p_line_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visit uuid; v_site uuid; v_supplier uuid; v_mat uuid; v_weight numeric;
  v_settle_status text; v_state text; v_is_receiving boolean;
begin
  select vm.visit_id, v.site_id, v.supplier_id, vm.material_type_id, vm.weight_kg, v.state
    into v_visit, v_site, v_supplier, v_mat, v_weight, v_state
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;

  v_is_receiving := public.current_role() = 'receiving' and v_site = public.current_site();

  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())
          or v_is_receiving), false) then
    raise exception 'not authorized to unsettle this line';
  end if;

  -- Receiving works the batch before the money does. Once a settlement exists
  -- the figures have been assembled from these lines, so pulling one out is the
  -- manager's call, not theirs.
  if v_is_receiving then
    select status into v_settle_status
      from public.batch_settlements where visit_id = v_visit;
    if v_settle_status is not null then
      raise exception 'this batch already has a settlement — ask the manager to unsettle it';
    end if;
    if v_state in ('stocked', 'exited') then
      raise exception 'cannot unsettle a line on a batch that is already %', v_state;
    end if;
  end if;

  update public.visit_materials
    set settlement_status = 'unsettled', unsettled_reason = nullif(p_reason, '')
    where id = p_line_id;

  if not exists (select 1 from public.gate_passes where visit_material_id = p_line_id and status <> 'cancelled') then
    insert into public.gate_passes
      (site_id, supplier_id, material_type_id, weight_kg, reason, visit_material_id,
       issued_by, status, requested_by, authorized_by, authorized_at)
    values (
      v_site, v_supplier, v_mat, v_weight,
      coalesce(nullif(p_reason, ''), 'Released — does not meet specification/pricing'),
      p_line_id, auth.uid(),
      -- Receiving raises the pass; a manager authorises it before the material
      -- can leave. Manager/owner sign their own on the spot.
      case when v_is_receiving then 'pending' else 'issued' end,
      case when v_is_receiving then auth.uid() else null end,
      case when v_is_receiving then null else auth.uid() end,
      case when v_is_receiving then null else now() end
    );
  end if;
end; $function$;

-- ── 3. Remove the anonymous surface ──────────────────────────────────────
-- anon and PUBLIC lose EXECUTE; the intended callers are re-granted explicitly.

revoke execute on function public.accountant_send_back_to_owner(p_visit_id uuid, p_reason text) from public, anon;
grant  execute on function public.accountant_send_back_to_owner(p_visit_id uuid, p_reason text) to authenticated, service_role;
revoke execute on function public.approve_visit_by_manager(p_visit_id uuid, p_skip_qc boolean) from public, anon;
grant  execute on function public.approve_visit_by_manager(p_visit_id uuid, p_skip_qc boolean) to authenticated, service_role;
revoke execute on function public.authorize_gate_pass(p_pass_id uuid) from public, anon;
grant  execute on function public.authorize_gate_pass(p_pass_id uuid) to authenticated, service_role;
revoke execute on function public.close_dressing_only(p_visit_id uuid, p_carry boolean) from public, anon;
grant  execute on function public.close_dressing_only(p_visit_id uuid, p_carry boolean) to authenticated, service_role;
revoke execute on function public.close_settlement(p_id uuid) from public, anon;
grant  execute on function public.close_settlement(p_id uuid) to authenticated, service_role;
revoke execute on function public.delete_supplier(p_supplier_id uuid) from public, anon;
grant  execute on function public.delete_supplier(p_supplier_id uuid) to authenticated, service_role;
revoke execute on function public.hold_advance(p_id uuid) from public, anon;
grant  execute on function public.hold_advance(p_id uuid) to authenticated, service_role;
revoke execute on function public.hold_expense(p_id uuid) from public, anon;
grant  execute on function public.hold_expense(p_id uuid) to authenticated, service_role;
revoke execute on function public.hold_settlement(p_id uuid) from public, anon;
grant  execute on function public.hold_settlement(p_id uuid) to authenticated, service_role;
revoke execute on function public.manager_skip_to_pricing(p_visit_id uuid) from public, anon;
grant  execute on function public.manager_skip_to_pricing(p_visit_id uuid) to authenticated, service_role;
revoke execute on function public.mark_price_correction_paid(p_id uuid) from public, anon;
grant  execute on function public.mark_price_correction_paid(p_id uuid) to authenticated, service_role;
revoke execute on function public.record_debt_repayment(p_supplier_id uuid, p_amount numeric, p_note text, p_kind text) from public, anon;
grant  execute on function public.record_debt_repayment(p_supplier_id uuid, p_amount numeric, p_note text, p_kind text) to authenticated, service_role;
revoke execute on function public.record_settlement_payment(p_settlement_id uuid, p_amount numeric, p_method text, p_note text, p_account_name text, p_account_number text, p_bank_name text) from public, anon;
grant  execute on function public.record_settlement_payment(p_settlement_id uuid, p_amount numeric, p_method text, p_note text, p_account_name text, p_account_number text, p_bank_name text) to authenticated, service_role;
revoke execute on function public.record_stock_check(p_lot_id uuid, p_status text, p_counted_weight numeric, p_note text) from public, anon;
grant  execute on function public.record_stock_check(p_lot_id uuid, p_status text, p_counted_weight numeric, p_note text) to authenticated, service_role;
revoke execute on function public.release_advance(p_id uuid) from public, anon;
grant  execute on function public.release_advance(p_id uuid) to authenticated, service_role;
revoke execute on function public.release_expense(p_id uuid) from public, anon;
grant  execute on function public.release_expense(p_id uuid) to authenticated, service_role;
revoke execute on function public.release_settlement(p_id uuid) from public, anon;
grant  execute on function public.release_settlement(p_id uuid) to authenticated, service_role;
revoke execute on function public.remove_line(p_line_id uuid) from public, anon;
grant  execute on function public.remove_line(p_line_id uuid) to authenticated, service_role;
revoke execute on function public.reopen_processing_fee(p_visit_id uuid) from public, anon;
grant  execute on function public.reopen_processing_fee(p_visit_id uuid) to authenticated, service_role;
revoke execute on function public.reopen_receiving(p_visit_id uuid) from public, anon;
grant  execute on function public.reopen_receiving(p_visit_id uuid) to authenticated, service_role;
revoke execute on function public.resettle_line(p_line_id uuid) from public, anon;
grant  execute on function public.resettle_line(p_line_id uuid) to authenticated, service_role;
revoke execute on function public.reverse_paid_supply(p_visit_id uuid, p_reason text) from public, anon;
grant  execute on function public.reverse_paid_supply(p_visit_id uuid, p_reason text) to authenticated, service_role;
revoke execute on function public.send_advance_back(p_id uuid, p_reason text) from public, anon;
grant  execute on function public.send_advance_back(p_id uuid, p_reason text) to authenticated, service_role;
revoke execute on function public.send_expense_back(p_id uuid, p_reason text) from public, anon;
grant  execute on function public.send_expense_back(p_id uuid, p_reason text) to authenticated, service_role;
revoke execute on function public.send_settlement_back(p_id uuid, p_reason text) from public, anon;
grant  execute on function public.send_settlement_back(p_id uuid, p_reason text) to authenticated, service_role;
revoke execute on function public.submit_visit_to_manager(p_visit_id uuid) from public, anon;
grant  execute on function public.submit_visit_to_manager(p_visit_id uuid) to authenticated, service_role;
revoke execute on function public.sync_processing_fee(p_visit_id uuid) from public, anon;
grant  execute on function public.sync_processing_fee(p_visit_id uuid) to authenticated, service_role;
revoke execute on function public.unsettle_line(p_line_id uuid, p_reason text) from public, anon;
grant  execute on function public.unsettle_line(p_line_id uuid, p_reason text) to authenticated, service_role;
