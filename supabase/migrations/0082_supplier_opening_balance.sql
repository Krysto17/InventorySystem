-- ─── Supplier opening balance (pre-software debt) ───────────────────────────
-- A supplier may owe money from before the app was in use. The debt ledger is
-- "Σ paid advances − Σ deductions", so a carried-over balance is recorded as a
-- one-off advance entered directly as PAID and dated to the opening date. It
-- counts toward the debt immediately and — being already paid — never appears
-- in the accountant's "to pay" queue. Owner-only; one per supplier.

create or replace function public.record_opening_balance(
  p_supplier_id uuid,
  p_amount numeric,
  p_as_of date default current_date,
  p_site_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_id uuid; v_ts timestamptz;
begin
  if not public.is_owner() then
    raise exception 'only the owner may record an opening balance';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'opening balance must be greater than zero';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier not found';
  end if;
  if exists (
    select 1 from public.advances
    where supplier_id = p_supplier_id and purpose = 'Opening balance (pre-software)'
  ) then
    raise exception 'an opening balance is already recorded for this supplier';
  end if;

  -- Advances are site-scoped; the debt total is per-supplier (site-agnostic), so
  -- default to the main site when none is given.
  v_site := coalesce(
    p_site_id,
    (select id from public.sites where name = 'New-Site' limit 1),
    (select id from public.sites order by created_at limit 1)
  );
  v_ts := p_as_of::timestamptz;

  insert into public.advances (
    supplier_id, site_id, purpose, amount_naira, approval_status,
    recorded_by, approved_by, approved_at, paid_by, paid_at, created_at
  ) values (
    p_supplier_id, v_site, 'Opening balance (pre-software)', p_amount, 'paid',
    auth.uid(), auth.uid(), v_ts, auth.uid(), v_ts, v_ts
  ) returning id into v_id;

  return v_id;
end; $$;

grant execute on function public.record_opening_balance(uuid, numeric, date, uuid) to authenticated;
