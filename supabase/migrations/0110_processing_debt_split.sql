-- ─── Processing (light-bill) debt is its own balance, not advance debt ───────
-- 0104 folded carried light bills into supplier_outstanding_debt, mixing two
-- different obligations. They are now tracked separately:
--   • ADVANCE debt    = paid advances − deductions of kind 'advance'
--   • PROCESSING debt = carried light bills − deductions of kind 'processing'
-- Deductions carry a `kind` so a recovery is applied to the right balance, and
-- each balance is guarded against over-deduction independently.

alter table public.advance_deductions
  add column if not exists kind text not null default 'advance'
    check (kind in ('advance', 'processing'));

create index if not exists advance_deductions_kind_idx on public.advance_deductions (supplier_id, kind);

-- 1. Advance debt: back to advances only (light bills removed).
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_naira) from public.advances
                   where supplier_id = _supplier_id and approval_status = 'paid'), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id and kind = 'advance'), 0);
$$;

-- 2. Processing debt: carried light bills minus processing recoveries.
create or replace function public.supplier_processing_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(uc.amount) from public.utility_charges uc
                   join public.visits v on v.id = uc.visit_id
                   where v.supplier_id = _supplier_id and uc.kind = 'light_bill' and uc.carried), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id and kind = 'processing'), 0);
$$;
grant execute on function public.supplier_processing_debt(uuid) to authenticated;

-- 3. Over-deduction guard now checks the balance matching the deduction's kind.
create or replace function public._advance_deductions_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare outstanding numeric;
begin
  if NEW.kind = 'processing' then
    outstanding := public.supplier_processing_debt(NEW.supplier_id);
  else
    outstanding := public.supplier_outstanding_debt(NEW.supplier_id);
  end if;
  if NEW.amount > outstanding then
    raise exception 'deduction %.2f exceeds outstanding % debt %.2f', NEW.amount, NEW.kind, outstanding
      using errcode = '23514';
  end if;
  return NEW;
end; $$;

-- 4. Repayments/deductions can target either balance.
create or replace function public.record_debt_repayment(
  p_supplier_id uuid,
  p_amount numeric,
  p_note text default null,
  p_kind text default 'advance'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_id uuid; v_role text;
begin
  v_role := public.current_role();
  if not (public.is_owner() or v_role in ('manager', 'accounting')) then
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
end; $$;

grant execute on function public.record_debt_repayment(uuid, numeric, text, text) to authenticated;

-- 5. settlement_totals: the `advances` figure counts only advance-kind
--    deductions on the visit; processing recoveries are reported separately.
create or replace function public.settlement_totals(p_visit_id uuid)
  returns table (materials numeric, processing_fee numeric, other_deductions numeric,
                 advances numeric, net numeric, remaining_debt numeric)
  language sql stable security definer set search_path = public as $$
  with m as (
    select coalesce(sum(purchase_amount), 0) as materials
    from public.visit_materials where visit_id = p_visit_id and settlement_status = 'settled'
  ), c as (
    select coalesce(sum(amount) filter (where kind = 'light_bill' and not carried), 0) as light,
           coalesce(sum(amount) filter (where kind = 'other'), 0) as other
    from public.utility_charges where visit_id = p_visit_id
  ), a as (
    -- Every recovery taken on this visit reduces the payout, whichever balance
    -- it settles (advance or carried processing fee).
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
