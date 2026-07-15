-- ─── Part payments + cash paid by the manager ───────────────────────────────
-- A supplier payout is no longer all-or-nothing. Payments (cash paid by the
-- manager, or transfer by the accountant) are recorded against the settlement
-- as a ledger; the settlement status is derived:
--   0 paid            → approved (unchanged)
--   0 < paid < net    → partially_paid
--   paid >= net       → paid  (tips stock intake as before)
-- Over-payment is blocked; a held/paid/rejected settlement takes no payment.

-- 1. 'partially_paid' status.
alter table public.batch_settlements
  drop constraint if exists batch_settlements_status_check;
alter table public.batch_settlements
  add constraint batch_settlements_status_check
  check (status in ('pending', 'approved', 'on_hold', 'partially_paid', 'rejected', 'paid'));

-- 2. The payment ledger. Inserts happen only through the RPC below (SECURITY
--    DEFINER), so RLS carries just a read policy for finance roles.
create table public.settlement_payments (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.batch_settlements(id) on delete cascade,
  site_id       uuid not null references public.sites(id),
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null check (method in ('cash', 'transfer', 'other')),
  note          text,
  paid_by       uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index settlement_payments_settlement_idx on public.settlement_payments(settlement_id, created_at);

alter table public.settlement_payments enable row level security;
create policy "settlement_payments: finance roles read"
  on public.settlement_payments for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- 3. Allow the ledger-driven status changes in the transition trigger. A
--    transaction-local GUC (set only inside record_settlement_payment) marks a
--    payment-driven change so the role checks below don't fire for it.
create or replace function public._batch_settlements_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then NEW.updated_at := now(); return NEW; end if;

  if coalesce(current_setting('app.ledger_payment', true), '') = 'on'
     and OLD.status in ('approved', 'partially_paid')
     and NEW.status in ('partially_paid', 'paid') then
    if NEW.status = 'paid' then
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    end if;
  elsif OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner approves or rejects a batch settlement';
    end if;
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
  elsif OLD.status = 'approved' and NEW.status = 'on_hold' then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner can hold a payment';
    end if;
    NEW.held_by := coalesce(NEW.held_by, auth.uid());
    NEW.held_at := coalesce(NEW.held_at, now());
  elsif OLD.status = 'on_hold' and NEW.status = 'approved' then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner can release a held payment';
    end if;
    NEW.held_by := null;
    NEW.held_at := null;
  elsif OLD.status = 'approved' and NEW.status = 'paid' then
    if auth.uid() is not null and public.current_role() <> 'accounting' then
      raise exception 'only the accountant can mark a settlement paid';
    end if;
    NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
    NEW.paid_at := coalesce(NEW.paid_at, now());
  else
    raise exception 'illegal batch settlement transition: % → %', OLD.status, NEW.status
      using errcode = '22000';
  end if;

  NEW.updated_at := now();
  return NEW;
end; $$;

-- 4. Total paid against a settlement (for the "remaining" figure).
create or replace function public.settlement_paid_total(p_settlement_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.settlement_payments where settlement_id = p_settlement_id;
$$;
grant execute on function public.settlement_paid_total(uuid) to authenticated;

-- 5. Record a payment (owner / accountant / manager, own site; general
--    manager/accountant any site). Part or full; blocks over-payment.
create or replace function public.record_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_method text,
  p_note text default null
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

  if not (public.is_owner() or public.is_general_manager() or public.is_general_accountant()
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

  insert into public.settlement_payments (settlement_id, site_id, amount, method, note, paid_by)
  values (p_settlement_id, v_site, p_amount, p_method, nullif(btrim(p_note), ''), auth.uid())
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

grant execute on function public.record_settlement_payment(uuid, numeric, text, text) to authenticated;
