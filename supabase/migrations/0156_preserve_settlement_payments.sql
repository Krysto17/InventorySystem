-- ─── 0156: a settlement with recorded payments is never deleted ─────────────
-- Audit 3F found two ways to erase supplier payments that had really been made
-- (F-01, F-02). Every one runs through a DELETE of batch_settlements, and
-- settlement_payments cascades from it:
--
--   * accountant_send_back_to_owner voided any settlement that was not 'paid' —
--     a partially_paid one included. Reproduced locally: a 30,000 part payment
--     vanished, and the owner's re-approval asked for the full 100,000 again.
--     The control is offered whenever the settlement is not 'paid'.
--   * approve_pricing replaces any non-paid settlement the same way.
--   * delete_batch let a manager / the GM delete a partially_paid or on_hold
--     batch, and the owner anything short of 'paid'. Deleting the visit
--     cascades to the settlement and on to its payments.
--   * send_settlement_back did check for payments, but without a lock: a
--     payment committing between its check and its delete was still erased.
--
-- Business ruling 3F-T1: once ANY payment is recorded against a settlement it
-- is preserved — not deleted, not replaced by repricing, not sent back — for
-- every role, the owner and general manager included. A settlement with no
-- payments keeps today's send-back / repricing / delete behaviour.
--
-- Payment ROWS are the authority, not the status string. Production had 48
-- settlements marked 'paid' before the payment ledger existed (0097), with no
-- payment rows; those stay protected by delete_batch's existing 'paid' check.
--
-- Two layers:
--   1. A BEFORE DELETE trigger on batch_settlements refuses the delete while a
--      payment row exists. It covers every path — these RPCs, a cascade from
--      deleting the visit, a direct table DELETE — whatever the role.
--      reverse_paid_supply is unaffected: it deletes the payments first, after
--      the supplier's refund is confirmed.
--   2. Each RPC locks the settlement row FOR UPDATE and checks for payments
--      before it changes anything, so it refuses cleanly and atomically.
--
-- Locking: record_settlement_payment (0151) locks the settlement row first. The
-- RPCs below now do the same before touching lines or the visit, so both sides
-- take locks in the same order (settlement, then visit). Whoever locks first
-- wins. A payment that commits first is seen by the check that runs after the
-- lock; a send-back or delete that commits first leaves the payment nothing to
-- lock ('settlement not found').
--
-- The refusal carries SQLSTATE SP001 so the app maps a code, not text. The
-- message names no id, table or constraint.

-- ── 0. Preconditions: payments and settlement statuses already agree ────────
do $$
declare n integer;
begin
  select count(*) into n from public.settlement_payments p
    join public.batch_settlements b on b.id = p.settlement_id
   where b.status not in ('partially_paid', 'paid');
  if n > 0 then
    raise exception '0156 precondition 1 failed: % payment(s) recorded against a settlement that is neither partially_paid nor paid', n;
  end if;

  select count(*) into n from public.batch_settlements b
   where b.status = 'partially_paid'
     and not exists (select 1 from public.settlement_payments p where p.settlement_id = b.id);
  if n > 0 then
    raise exception '0156 precondition 2 failed: % partially_paid settlement(s) have no payment rows', n;
  end if;
end $$;

-- ── 1. The invariant: no delete while payment history exists ────────────────
create or replace function public._batch_settlements_preserve_payments()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A BEFORE ROW trigger runs after the row lock is taken, so a payment that
  -- committed while this delete waited is visible here.
  if exists (select 1 from public.settlement_payments where settlement_id = OLD.id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;
  return OLD;
end; $$;

create trigger t_batch_settlements_preserve_payments
  before delete on public.batch_settlements
  for each row execute function public._batch_settlements_preserve_payments();

-- ── 2. Accounting → owner send-back ──────────────────────────────────────────
create or replace function public.accountant_send_back_to_owner(p_visit_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_state text; v_site uuid; v_settle text; v_settle_id uuid;
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

  -- Lock before reading, the lock order record_settlement_payment uses.
  select id, status into v_settle_id, v_settle from public.batch_settlements
    where visit_id = p_visit_id order by created_at desc limit 1
    for update;
  if v_settle = 'paid' then
    raise exception 'this batch is already paid — record a price correction instead';
  end if;
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
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

-- ── 3. Owner price approval (replaces a non-paid settlement) ─────────────────
create or replace function public.approve_pricing(p_visit_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_state text; v_site uuid; t record; v_settle_id uuid;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;

  -- The settlement is replaced below. Lock it first (settlement before lines
  -- and visit, as payments do) and refuse if it carries payment history.
  select id into v_settle_id from public.batch_settlements
    where visit_id = p_visit_id and status <> 'paid'
    for update;
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

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
end; $function$;

-- ── 4. Payables send-back (already checked, but without a lock) ──────────────
create or replace function public.send_settlement_back(p_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_site uuid; v_status text; v_visit uuid;
begin
  select site_id, status, visit_id into v_site, v_status, v_visit from public.batch_settlements
    where id = p_id
    for update;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to send this back'; end if;
  if v_status not in ('approved', 'on_hold') then
    raise exception 'only an approved or held (unpaid) settlement can be sent back';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  if exists (select 1 from public.settlement_payments where settlement_id = p_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  delete from public.batch_settlements where id = p_id;
  perform set_config('app.allow_price_unlock', 'on', true);
  update public.visit_materials set price_finalized = false where visit_id = v_visit;
  update public.visits set state = 'pricing' where id = v_visit;
  insert into public.batch_comments (visit_id, site_id, body, author)
  values (v_visit, v_site, '↩︎ Payment sent back by ' || public.current_role() || ' for correction: ' || btrim(p_reason), auth.uid());
end; $function$;

-- ── 5. Batch delete (the visit delete cascades to the settlement) ────────────
create or replace function public.delete_batch(p_visit_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_settle_status text; v_settle_id uuid; v_state text; v_site uuid; v_role text;
begin
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;

  -- Lock the settlement before the visit delete reaches it, in the order a
  -- payment takes (settlement, then visit).
  select id, status into v_settle_id, v_settle_status
    from public.batch_settlements where visit_id = p_visit_id
    for update;
  v_role := public.current_role();

  if public.is_owner() then
    if v_settle_status = 'paid' then
      raise exception 'cannot delete a batch that has been paid';
    end if;
  elsif public.is_general_manager() then
    if v_settle_status in ('approved', 'paid') then
      raise exception 'cannot delete a batch the owner has already approved';
    end if;
  elsif v_role = 'manager' and v_site = public.current_site() then
    -- Any site manager, on their own site, until the owner has approved it.
    if v_settle_status in ('approved', 'paid') then
      raise exception 'cannot delete a batch the owner has already approved';
    end if;
  elsif v_role = 'processing' and v_site = public.current_site() then
    if v_state <> 'in_processing' then
      raise exception 'processing can only delete a visit still in processing';
    end if;
  elsif v_role = 'receiving' and v_site = public.current_site() then
    -- Receiving may remove the whole visit until money or stock is involved.
    if v_settle_status is not null then
      raise exception 'this batch already has a settlement — ask the manager to remove it';
    end if;
    if v_state in ('stocked', 'exited') then
      raise exception 'cannot delete a batch that is already %', v_state;
    end if;
  else
    raise exception 'not authorized to delete batches';
  end if;

  -- No role, the owner included, deletes recorded payment history.
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  delete from public.visits where id = p_visit_id;
end; $function$;
