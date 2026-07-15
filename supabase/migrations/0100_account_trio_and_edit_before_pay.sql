-- ─── Account details always complete + edit/delete only before payment ──────
-- 1. Any transaction that stores bank account details (suppliers, advances,
--    expenses) must carry the full set — account name, a 10-digit account
--    number, and bank name — together, or none at all. Enforced only when those
--    fields are written, so unrelated edits to legacy rows are unaffected.
-- 2. The manager may edit/delete an advance or expense until it is paid; a paid
--    advance/expense is locked.

-- ── Complete-account trigger (shared across the three tables) ────────────────
create or replace function public._require_complete_account()
  returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT'
     or NEW.account_name is distinct from OLD.account_name
     or NEW.account_number is distinct from OLD.account_number
     or NEW.bank_name is distinct from OLD.bank_name then
    if not (
      (nullif(btrim(coalesce(NEW.account_name, '')), '') is null
        and nullif(btrim(coalesce(NEW.account_number, '')), '') is null
        and nullif(btrim(coalesce(NEW.bank_name, '')), '') is null)
      or (nullif(btrim(coalesce(NEW.account_name, '')), '') is not null
        and NEW.account_number ~ '^\d{10}$'
        and nullif(btrim(coalesce(NEW.bank_name, '')), '') is not null)
    ) then
      raise exception 'account name, a 10-digit account number, and bank name must be provided together'
        using errcode = '23514';
    end if;
  end if;
  return NEW;
end; $$;

create trigger t_suppliers_complete_account
  before insert or update on public.suppliers
  for each row execute function public._require_complete_account();
create trigger t_advances_complete_account
  before insert or update on public.advances
  for each row execute function public._require_complete_account();
create trigger t_consumables_complete_account
  before insert or update on public.consumables
  for each row execute function public._require_complete_account();

-- ── Advances: manager may delete until paid (was pending-only) ───────────────
drop policy if exists "advances: manager deletes own-site pending, owner any" on public.advances;
create policy "advances: manager deletes own-site unpaid, owner any"
  on public.advances for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'manager' and site_id = public.current_site() and approval_status <> 'paid')
  );

-- ── Lock a paid advance / expense against further changes ────────────────────
create or replace function public._advances_before_update()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.approval_status = 'paid' then
    raise exception 'a paid advance can no longer be modified';
  end if;
  if NEW.approval_status is distinct from OLD.approval_status then
    if coalesce(current_setting('app.payable_review', true), '') = 'on'
       and ((OLD.approval_status = 'approved' and NEW.approval_status in ('on_hold', 'pending'))
         or (OLD.approval_status = 'on_hold' and NEW.approval_status in ('approved', 'pending'))) then
      null;
    elsif OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
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

create or replace function public._consumables_approval_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.approval_status = 'paid' then
    raise exception 'a paid expense can no longer be modified';
  end if;
  if NEW.approval_status is distinct from OLD.approval_status then
    if coalesce(current_setting('app.payable_review', true), '') = 'on'
       and ((OLD.approval_status = 'approved' and NEW.approval_status in ('on_hold', 'pending'))
         or (OLD.approval_status = 'on_hold' and NEW.approval_status in ('approved', 'pending'))) then
      null;
    elsif OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
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
