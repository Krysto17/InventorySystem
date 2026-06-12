-- ─── Phase 11 (C): Payment statuses ──────────────────────────────────────────
-- Blueprint statuses: Pending / Approved / Paid / Partially Paid / Rejected.
-- Workflow: the accountant raises a payment as 'pending' → the OWNER approves
-- (or rejects) → the accountant executes and marks it 'paid' (or
-- 'partially_paid' when only part was disbursed, then 'paid' on completion).
--
-- Backward compatibility: Phase 3 recorded payments as facts (money already
-- moved), so the column defaults to 'paid' and existing rows backfill to
-- 'paid'. Direct inserts may only carry 'pending' or 'paid' (owner excepted).
-- Balance computations count only 'paid' / 'partially_paid' rows.

alter table public.payments
  add column status text not null default 'paid'
    check (status in ('pending', 'approved', 'paid', 'partially_paid', 'rejected')),
  add column status_note text;

create index payments_status_idx on public.payments (status) where status <> 'paid';

-- Inserts: non-owner may only create 'pending' (request) or 'paid' (record of fact).
create or replace function public._payments_status_on_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.status not in ('pending', 'paid') and not public.is_owner() then
    raise exception 'payments may only be created as pending or paid';
  end if;
  return NEW;
end;
$$;

create trigger t_payments_status_insert
  before insert on public.payments
  for each row execute function public._payments_status_on_insert();

-- Updates: enforce the lifecycle + who may move each edge.
create or replace function public._payments_status_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  if OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if not public.is_owner() then
      raise exception 'only the owner approves or rejects a payment';
    end if;
  elsif OLD.status = 'approved' and NEW.status in ('paid', 'partially_paid') then
    if not (public.is_owner() or public.current_role() = 'accounting') then
      raise exception 'only accounting or the owner can execute an approved payment';
    end if;
  elsif OLD.status = 'partially_paid' and NEW.status = 'paid' then
    if not (public.is_owner() or public.current_role() = 'accounting') then
      raise exception 'only accounting or the owner can complete a payment';
    end if;
  else
    raise exception 'illegal payment status transition: % → %', OLD.status, NEW.status
      using errcode = '22000';
  end if;

  return NEW;
end;
$$;

create trigger t_payments_status_transition
  before update of status on public.payments
  for each row execute function public._payments_status_transition();
