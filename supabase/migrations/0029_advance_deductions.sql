-- ─── Phase 11 (A): Supplier debt ledger — advance deductions ─────────────────
-- Supersedes Phase 9's "standalone advances" stance (owner-confirmed): approved
-- advances now form a per-supplier DEBT that the manager/accountant recovers by
-- deducting from later payouts — multiple advances, PARTIAL deductions, and an
-- automatically maintained outstanding balance.
--
--   outstanding debt = Σ approved advances − Σ deductions
--
-- A deduction may be tied to the visit whose payout it was withheld from
-- (ref_visit_id) or stand alone (cash repayment). Over-deduction is blocked at
-- the DB level. Utility bills are NOT recovered here — they are visit-scoped
-- charges (0030) settled through the existing payments ledger.

create table public.advance_deductions (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id),
  site_id      uuid not null references public.sites(id),
  ref_visit_id uuid references public.visits(id),
  amount       numeric(14,2) not null check (amount > 0),
  notes        text,
  recorded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index advance_deductions_supplier_idx on public.advance_deductions (supplier_id);
create index advance_deductions_site_idx     on public.advance_deductions (site_id);

-- Outstanding debt for a supplier (approved advances minus all deductions).
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce((select sum(amount_naira) from public.advances
                   where supplier_id = _supplier_id and approval_status = 'approved'), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id), 0);
$$;

grant execute on function public.supplier_outstanding_debt(uuid) to authenticated;

-- Guard: a deduction may never exceed the outstanding debt.
create or replace function public._advance_deductions_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  outstanding numeric;
begin
  outstanding := public.supplier_outstanding_debt(NEW.supplier_id);
  if NEW.amount > outstanding then
    raise exception 'deduction %.2f exceeds outstanding debt %.2f', NEW.amount, outstanding
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

create trigger t_advance_deductions_guard
  before insert on public.advance_deductions
  for each row execute function public._advance_deductions_guard();

-- Audit into transaction_events when tied to a visit.
create or replace function public._advance_deductions_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.ref_visit_id is not null then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.ref_visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'advance_deductions', 'record_id', NEW.id,
                               'supplier_id', NEW.supplier_id, 'amount', NEW.amount));
  end if;
  return NEW;
end;
$$;

create trigger t_advance_deductions_after
  after insert on public.advance_deductions
  for each row execute function public._advance_deductions_after();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.advance_deductions enable row level security;

create policy "advance_deductions: read own site or cross-site reporter"
  on public.advance_deductions for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- Manager and accountant record deductions on their own site; owner anywhere.
create policy "advance_deductions: manager/accounting insert own site"
  on public.advance_deductions for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and site_id = public.current_site()
    )
  );
