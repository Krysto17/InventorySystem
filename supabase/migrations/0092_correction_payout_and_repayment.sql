-- ─── Underpaid corrections become a real payout; debt repaid outside the app ──
-- Two owner-requested finance flows:
--
--  (1) An UNDERPAID price correction is no longer just a memo — it is money the
--      company still owes the supplier. It now flows to the accountant's payout
--      queue (like a batch settlement) and is marked paid when disbursed. The
--      paid settlement stays locked; the correction is a compensating entry.
--      OVERPAID corrections stay a pure record (recovered manually / as debt).
--
--  (2) A supplier sometimes clears outstanding debt by BANK TRANSFER outside the
--      app. That is a standalone advance_deduction (ref_visit_id null) — the
--      mechanism already exists; migration adds a thin RPC so a repayment can be
--      recorded from the supplier page (owner anywhere, manager/accounting on
--      their own site) with the DB's over-deduction guard still enforced.

-- (1) Payment lifecycle on price corrections ----------------------------------
alter table public.price_corrections
  add column if not exists paid_by uuid references public.profiles(id),
  add column if not exists paid_at timestamptz;

-- The accountant marks an underpaid correction paid once disbursed. Mirrors the
-- batch-settlement mark-paid: accounting only, own site (or cross-site payer),
-- and only for an unpaid underpaid correction.
create or replace function public.mark_price_correction_paid(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
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
  if not (v_site = public.current_site() or public.is_general_accountant()) then
    raise exception 'no access to this site';
  end if;
  update public.price_corrections
    set paid_by = auth.uid(), paid_at = now()
    where id = p_id;
end; $$;

grant execute on function public.mark_price_correction_paid(uuid) to authenticated;

-- (2) Record a supplier debt repayment made outside the app -------------------
-- A standalone deduction (no visit) that reduces outstanding debt. The existing
-- _advance_deductions_guard still blocks over-repayment.
create or replace function public.record_debt_repayment(
  p_supplier_id uuid,
  p_amount numeric,
  p_note text default null
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
  -- Site to attach the ledger row to: the recorder's own site, else (owner, who
  -- has none) the supplier's most recent visit site.
  v_site := public.current_site();
  if v_site is null then
    select site_id into v_site from public.visits
      where supplier_id = p_supplier_id order by created_at desc limit 1;
  end if;
  if v_site is null then
    select id into v_site from public.sites order by created_at limit 1;
  end if;
  insert into public.advance_deductions (supplier_id, site_id, ref_visit_id, amount, notes, recorded_by)
  values (
    p_supplier_id, v_site, null, p_amount,
    coalesce(nullif(btrim(p_note), ''), 'Repayment — paid outside the app'),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.record_debt_repayment(uuid, numeric, text) to authenticated;
