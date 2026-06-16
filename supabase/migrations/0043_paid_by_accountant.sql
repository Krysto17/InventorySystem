-- ─── Payment authority: only the accountant marks things paid ────────────────
-- Owner approves; the ACCOUNTANT executes payment. Applies to supplies (batch
-- settlements), payments, advances, and expenses (consumables). Advances and
-- consumables gain an explicit 'paid' step after owner approval.

-- ── batch_settlements: approved → paid is accountant-only ─────────────────────
create or replace function public._batch_settlements_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then NEW.updated_at := now(); return NEW; end if;

  if OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner approves or rejects a batch settlement';
    end if;
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
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

-- batch_settlements update RLS: owner (approve/reject) + accounting (pay).
drop policy if exists "batch_settlements: owner/accountant update" on public.batch_settlements;
create policy "batch_settlements: owner/accountant update"
  on public.batch_settlements for update to authenticated
  using (public.is_owner() or (public.current_role() = 'accounting' and site_id = public.current_site()))
  with check (public.is_owner() or (public.current_role() = 'accounting' and site_id = public.current_site()));

-- ── payments: paid / partially_paid are accountant-only ──────────────────────
create or replace function public._payments_status_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then return NEW; end if;

  if OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner approves or rejects a payment';
    end if;
  elsif OLD.status = 'approved' and NEW.status in ('paid', 'partially_paid') then
    if auth.uid() is not null and public.current_role() <> 'accounting' then
      raise exception 'only the accountant can execute an approved payment';
    end if;
  elsif OLD.status = 'partially_paid' and NEW.status = 'paid' then
    if auth.uid() is not null and public.current_role() <> 'accounting' then
      raise exception 'only the accountant can complete a payment';
    end if;
  else
    raise exception 'illegal payment status transition: % → %', OLD.status, NEW.status
      using errcode = '22000';
  end if;
  return NEW;
end; $$;

-- ── advances: add a 'paid' step (owner approves → accountant pays) ────────────
alter table public.advances
  drop constraint if exists advances_approval_status_check;
alter table public.advances
  add constraint advances_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected', 'paid'));
alter table public.advances
  add column if not exists paid_by uuid references public.profiles(id),
  add column if not exists paid_at timestamptz;

create or replace function public._advances_before_update()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.approval_status is distinct from OLD.approval_status then
    if OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
      if auth.uid() is not null and not public.is_owner() then
        raise exception 'only the owner approves or rejects an advance';
      end if;
      NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
      NEW.approved_at := coalesce(NEW.approved_at, now());
    elsif OLD.approval_status = 'approved' and NEW.approval_status = 'paid' then
      if auth.uid() is not null and public.current_role() <> 'accounting' then
        raise exception 'only the accountant can mark an advance paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal advance transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $$;

-- An approved OR paid advance is a recoverable debt (paid = disbursed to the
-- supplier). Count both toward the outstanding balance.
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_naira) from public.advances
                   where supplier_id = _supplier_id and approval_status in ('approved', 'paid')), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id), 0);
$$;

-- ── consumables (expenses): add a 'paid' step; accountant may update ─────────
alter table public.consumables
  drop constraint if exists consumables_approval_status_check;
alter table public.consumables
  add constraint consumables_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected', 'paid'));
alter table public.consumables
  add column if not exists paid_by uuid references public.profiles(id),
  add column if not exists paid_at timestamptz;

create or replace function public._consumables_approval_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.approval_status is distinct from OLD.approval_status then
    if OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
      if auth.uid() is not null and not public.is_owner() then
        raise exception 'only the owner approves expenses';
      end if;
      NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
      NEW.approved_at := coalesce(NEW.approved_at, now());
    elsif OLD.approval_status = 'approved' and NEW.approval_status = 'paid' then
      if auth.uid() is not null and public.current_role() <> 'accounting' then
        raise exception 'only the accountant marks expenses paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal expense status transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  return NEW;
end; $$;

-- Allow the accountant (and manager) to update consumables on their site so the
-- accountant can mark expenses paid; the guard restricts which status each role sets.
drop policy if exists "consumables: inventory + owner update on own site" on public.consumables;
create policy "consumables: site roles update own site"
  on public.consumables for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() in ('inventory', 'manager', 'accounting') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() in ('inventory', 'manager', 'accounting') and site_id = public.current_site())
  );
