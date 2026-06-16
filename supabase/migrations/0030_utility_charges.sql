-- ─── Phase 11 (B): Utility / processing billing ──────────────────────────────
-- The blueprint's Utility/Processing module: light bills and other utility
-- charges recorded per visit, on top of the machine-usage processing fee.
-- Utility charges are money the CLIENT owes the COMPANY (same direction as the
-- processing fee) and are settled through the existing payments ledger
-- (processing_fee_in; method 'deduction' covers netting from a payout).
-- The branded utility invoice PDF renders machines + utility charges + totals.

create table public.utility_charges (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  kind        text not null check (kind in ('light_bill', 'other')),
  description text,
  amount      numeric(14,2) not null check (amount > 0),
  recorded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index utility_charges_visit_idx on public.utility_charges (visit_id);

-- Audit
create or replace function public._utility_charges_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_created', NEW.recorded_by,
          jsonb_build_object('table', 'utility_charges', 'record_id', NEW.id,
                             'kind', NEW.kind, 'amount', NEW.amount));
  return NEW;
end;
$$;

create trigger t_utility_charges_after
  after insert on public.utility_charges
  for each row execute function public._utility_charges_after();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.utility_charges enable row level security;

create policy "utility_charges: read by visit visibility"
  on public.utility_charges for select to authenticated
  using (
    public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = utility_charges.visit_id and v.site_id = public.current_site())
  );

-- Processing records them at the plant; manager may add/correct; owner anywhere.
-- Only while the visit is open.
create policy "utility_charges: processing/manager insert own site while open"
  on public.utility_charges for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('processing', 'manager')
      and exists (select 1 from public.visits v
                  where v.id = utility_charges.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(utility_charges.visit_id)
    )
  );
