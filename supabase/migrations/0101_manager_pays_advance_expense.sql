-- ─── Manager (and owner) may mark an advance / expense paid ──────────────────
-- Cash payouts are often made by the manager, not the accountant. The advance
-- and expense guards previously allowed only the accountant to take the
-- approved → paid step; now the owner and a manager (site enforced by RLS) may
-- too. A held item still can't be paid (must be released first), and a paid
-- item stays locked.

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
      if auth.uid() is not null
         and not (public.is_owner() or public.current_role() in ('accounting', 'manager')) then
        raise exception 'only the accountant, manager, or owner can mark an advance paid';
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
      if auth.uid() is not null
         and not (public.is_owner() or public.current_role() in ('accounting', 'manager')) then
        raise exception 'only the accountant, manager, or owner can mark an expense paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal expense status transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  return NEW;
end; $$;
