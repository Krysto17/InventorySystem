-- ─── Phase 11 (E): Expense approval flow ─────────────────────────────────────
-- The blueprint's expense module: a manager submits an expense (type, amount¹,
-- date) which the OWNER approves. Merged into the Phase 9 consumables log (one
-- categorized expense table) instead of a parallel table: consumables gain an
-- approval_status; managers may now also log them; only the owner can flip the
-- status. Existing rows (logged before approvals existed) backfill 'approved'.
--
-- ¹ amount: the Phase 9 log was deliberately amount-free (categorized log, not
--   bookkeeping). The blueprint asks for an amount on expenses, so an optional
--   amount_naira is added — still per-entry record-keeping, not a P&L.

alter table public.consumables
  add column amount_naira numeric(14,2) check (amount_naira is null or amount_naira > 0),
  add column approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz;

update public.consumables set approval_status = 'approved' where approval_status = 'pending';

-- Only the owner may change approval_status (stamped on change).
create or replace function public._consumables_approval_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.approval_status is distinct from OLD.approval_status then
    if not public.is_owner() then
      raise exception 'only the owner approves expenses';
    end if;
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
  end if;
  return NEW;
end;
$$;

create trigger t_consumables_approval_guard
  before update on public.consumables
  for each row execute function public._consumables_approval_guard();

-- Managers may also submit expenses (blueprint), alongside inventory + owner.
drop policy if exists "consumables: inventory + owner insert" on public.consumables;
create policy "consumables: inventory/manager/owner insert"
  on public.consumables for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('inventory', 'manager')
      and site_id = public.current_site()
    )
  );
