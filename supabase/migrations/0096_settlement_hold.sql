-- ─── Owner can hold (and later release) an approved supplier payment ─────────
-- After the owner approves a batch settlement but before the accountant pays
-- it, the owner may put the payment ON HOLD (it drops off the accountant's
-- to-pay queue) and RELEASE it later (it returns to the queue). A held payment
-- must be released before it can be paid.

-- 1. New status + who/when it was held.
alter table public.batch_settlements
  drop constraint if exists batch_settlements_status_check;
alter table public.batch_settlements
  add constraint batch_settlements_status_check
  check (status in ('pending', 'approved', 'on_hold', 'rejected', 'paid'));

alter table public.batch_settlements
  add column if not exists held_by uuid references public.profiles(id),
  add column if not exists held_at timestamptz;

-- 2. Allow the owner-only approved ↔ on_hold transitions (stamp/clear held_*).
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
