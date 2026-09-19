-- 0163 — Duplicate / retry integrity (Phase 3F-T8: F-11)
--
-- One intended action must produce at most one business effect. LOCAL 0162
-- proved it does not: submitting the same action twice produced two of
-- everything that matters —
--   * a ₦30,000 settlement payment paid ₦60,000 (two payment rows);
--   * a ₦50,000 debt recovery reduced the supplier's debt twice;
--   * a 100 kg bulk sale took 200 kg out of the bucket;
--   * one expense became two payables; one advance became two advances;
--   * one light bill billed the client twice;
--   * one draft cost-price run became two, one material line became two,
--     one gate log and one free-text gate pass became two.
--
-- ── Why a request key and not uniqueness on the business fields ─────────────
-- Two ₦50,000 repayments on the same day are legitimate. So are two identical
-- diesel expenses, two advances of the same amount to the same supplier, two
-- "other" utility charges, and several lines of the same material on one batch
-- at different weights. Nothing in the business fields distinguishes a retry
-- from a second genuine action, so no UNIQUE over amount/date/supplier is safe.
-- What separates them is the INTENT: one click is one command. Each of these
-- tables therefore carries the identity of the command that created the row,
-- and it is that — not the money — which is unique.
--
-- ── Why per-row keys and not a central idempotency table ───────────────────
-- Every operation here is a single insert made by one server action. A central
-- table would add a second write, a second failure mode and a retention policy
-- to each of them, and would still have to be joined back to the row it
-- protects. The key lives on the row instead: one column, one partial unique
-- index, no extra write, and a rollback that is a column drop.
--
-- ── Historical rows are not touched ────────────────────────────────────────
-- Existing rows keep request_key NULL and the index is partial
-- (WHERE request_key IS NOT NULL), so nothing historical can collide and no
-- backfill — which would be a business-data rewrite — is needed. The known
-- duplicate paid-expense pairs stay exactly where they are, for the separate
-- reconciliation they were deferred to.
--
-- ── Omitting the key is not a bypass ───────────────────────────────────────
-- A BEFORE INSERT trigger stamps a fresh key when a caller sends none, so every
-- new row is covered by the unique index. A caller that omits the key does not
-- escape the constraint; it simply declares "this insert is its own command"
-- and forfeits replay protection for itself. It can never suppress or duplicate
-- somebody else's effect, and the service role is not exempt.
--
-- Already protected before this migration, and deliberately NOT duplicated here:
--   gate_passes_one_live_pass_per_lot            (0155) one live pass per lot
--   stock_movements_one_release_per_gate_pass    (0155) one release per pass
--   cost_price_run_lots (run_id, stock_lot_id)   PK, plus CP003 reservation
--   advance_shares (advance_id, supplier_id)
--   batch_settlements (visit_id)
--   repeat approval of an expense, advance, pricing or cost-price run (T7 ST001)

-- ── The command identity ────────────────────────────────────────────────────
alter table public.settlement_payments add column if not exists request_key uuid;
alter table public.advance_deductions  add column if not exists request_key uuid;
alter table public.stock_movements     add column if not exists request_key uuid;
alter table public.consumables         add column if not exists request_key uuid;
alter table public.advances            add column if not exists request_key uuid;
alter table public.utility_charges     add column if not exists request_key uuid;
alter table public.cost_price_runs     add column if not exists request_key uuid;
alter table public.visit_materials     add column if not exists request_key uuid;
alter table public.gate_logs           add column if not exists request_key uuid;
alter table public.gate_passes         add column if not exists request_key uuid;

create or replace function public._stamp_request_key()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- A caller that sends no key still gets one, so the unique index covers every
  -- new row. Only a caller that repeats ITS OWN key can be replayed.
  if NEW.request_key is null then
    NEW.request_key := gen_random_uuid();
  end if;
  return NEW;
end;
$function$;

-- Partial, so the historical NULL rows neither collide nor need rewriting.
create unique index if not exists settlement_payments_request_key_idx
  on public.settlement_payments (request_key) where request_key is not null;
create unique index if not exists advance_deductions_request_key_idx
  on public.advance_deductions (request_key) where request_key is not null;
create unique index if not exists stock_movements_request_key_idx
  on public.stock_movements (request_key) where request_key is not null;
create unique index if not exists consumables_request_key_idx
  on public.consumables (request_key) where request_key is not null;
create unique index if not exists advances_request_key_idx
  on public.advances (request_key) where request_key is not null;
create unique index if not exists utility_charges_request_key_idx
  on public.utility_charges (request_key) where request_key is not null;
create unique index if not exists cost_price_runs_request_key_idx
  on public.cost_price_runs (request_key) where request_key is not null;
create unique index if not exists visit_materials_request_key_idx
  on public.visit_materials (request_key) where request_key is not null;
create unique index if not exists gate_logs_request_key_idx
  on public.gate_logs (request_key) where request_key is not null;
create unique index if not exists gate_passes_request_key_idx
  on public.gate_passes (request_key) where request_key is not null;

-- 'a_' so the key is stamped before any guard that might read it.
create trigger a_settlement_payments_request_key before insert on public.settlement_payments
  for each row execute function public._stamp_request_key();
create trigger a_advance_deductions_request_key before insert on public.advance_deductions
  for each row execute function public._stamp_request_key();
create trigger a_stock_movements_request_key before insert on public.stock_movements
  for each row execute function public._stamp_request_key();
create trigger a_consumables_request_key before insert on public.consumables
  for each row execute function public._stamp_request_key();
create trigger a_advances_request_key before insert on public.advances
  for each row execute function public._stamp_request_key();
create trigger a_utility_charges_request_key before insert on public.utility_charges
  for each row execute function public._stamp_request_key();
create trigger a_cost_price_runs_request_key before insert on public.cost_price_runs
  for each row execute function public._stamp_request_key();
create trigger a_visit_materials_request_key before insert on public.visit_materials
  for each row execute function public._stamp_request_key();
create trigger a_gate_logs_request_key before insert on public.gate_logs
  for each row execute function public._stamp_request_key();
create trigger a_gate_passes_request_key before insert on public.gate_passes
  for each row execute function public._stamp_request_key();

-- ── Payments ────────────────────────────────────────────────────────────────
-- Installments are legitimate, so UNIQUE(settlement_id) would be wrong. The
-- command is what must be unique. The parameter has a default so the existing
-- six-argument call still resolves — but it resolves to NULL, and a NULL key is
-- refused, so there is no versionless payment path left.
--
-- A replay does not raise: it returns the payment the first call created, which
-- is what a client that never saw the first response needs to hear.
--
-- The seven-argument version is DROPPED rather than left beside this one.
-- Adding a parameter to a function creates an OVERLOAD, not a replacement, and
-- an overload that still takes no command id is exactly the versionless payment
-- path this migration exists to remove. Dropping it also makes a three-argument
-- call resolve here, to ID001, instead of failing as ambiguous.
drop function if exists public.record_settlement_payment(uuid, numeric, text, text, text, text, text);

create or replace function public.record_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_method text,
  p_note text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_bank_name text default null,
  p_request_key uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_role text; v_site uuid; v_status text; v_net numeric; v_paid numeric; v_id uuid;
begin
  if p_request_key is null then
    raise exception 'this payment did not identify itself; refresh the page and try again'
      using errcode = 'ID001';
  end if;

  -- A replay of a payment that already landed returns that payment. Checked
  -- before the settlement lock so a retry never queues behind live work.
  select id into v_id from public.settlement_payments where request_key = p_request_key;
  if v_id is not null then
    return v_id;
  end if;

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

  -- Two identical commands that raced: the loser waited on the lock above, and
  -- the winner has now committed. Answer with the winner's payment.
  select id into v_id from public.settlement_payments where request_key = p_request_key;
  if v_id is not null then
    return v_id;
  end if;

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
    (settlement_id, site_id, amount, method, note, paid_by, account_name, account_number, bank_name, request_key)
  values
    (p_settlement_id, v_site, p_amount, p_method, nullif(btrim(p_note), ''), auth.uid(),
     nullif(btrim(p_account_name), ''), nullif(btrim(p_account_number), ''), nullif(btrim(p_bank_name), ''),
     p_request_key)
  returning id into v_id;

  -- Recompute the derived status (ledger-driven; bypasses the role checks).
  perform set_config('app.ledger_payment', 'on', true);
  if (v_paid + p_amount) >= v_net - 0.005 then
    update public.batch_settlements set status = 'paid' where id = p_settlement_id;
  else
    update public.batch_settlements set status = 'partially_paid' where id = p_settlement_id;
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.record_settlement_payment(uuid, numeric, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_settlement_payment(uuid, numeric, text, text, text, text, text, uuid) to authenticated;
