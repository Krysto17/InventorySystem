-- Add processing_deducted flag to visits
alter table public.visits
  add column processing_deducted boolean not null default false;

-- ─── payments table ──────────────────────────────────────────────────────
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.visits(id) on delete cascade,
  direction    text not null check (direction in ('processing_fee_in', 'purchase_amount_out')),
  amount       numeric(14,2) not null check (amount > 0),
  paid_at      timestamptz not null default now(),
  method       text check (method in ('cash', 'transfer', 'deduction', 'other')),
  notes        text,
  recorded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index payments_visit_idx on public.payments (visit_id, direction);

-- ─── Audit trigger ───────────────────────────────────────────────────────
create or replace function public._payments_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object(
              'table', 'payments',
              'record_id', NEW.id,
              'direction', NEW.direction,
              'amount', NEW.amount,
              'method', NEW.method
            ));
    return NEW;
  end if;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'payments',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));
  return NEW;
end;
$$;

create trigger t_payments_audit
  after insert or update on public.payments
  for each row execute function public._payments_after();

-- ─── RLS on payments ─────────────────────────────────────────────────────
alter table public.payments enable row level security;

-- Read: own site for non-owner, all for owner
create policy "payments: read own site"
  on public.payments
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.visits v
      where v.id = payments.visit_id
        and v.site_id = public.current_site()
    )
  );

-- Insert: accounting role on own site, or owner
create policy "payments: accounting inserts on own site"
  on public.payments
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'accounting'
      and exists (
        select 1 from public.visits v
        where v.id = payments.visit_id
          and v.site_id = public.current_site()
      )
    )
  );

-- Update: accounting on own site (for notes/method corrections), or owner
create policy "payments: accounting updates on own site"
  on public.payments
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'accounting'
      and exists (
        select 1 from public.visits v
        where v.id = payments.visit_id
          and v.site_id = public.current_site()
      )
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'accounting'
      and exists (
        select 1 from public.visits v
        where v.id = payments.visit_id
          and v.site_id = public.current_site()
      )
    )
  );

-- ─── processing_deducted column grant ────────────────────────────────────
-- Accounting can flip the flag; others cannot write visits columns directly
-- (Accounting role cannot update visits table via existing RLS, so we add a
-- separate column-level grant + policy for this one column.)
create policy "visits: accounting updates processing_deducted"
  on public.visits
  for update to authenticated
  using (
    public.current_role() = 'accounting'
    and site_id = public.current_site()
  )
  with check (
    public.current_role() = 'accounting'
    and site_id = public.current_site()
  );

grant update (processing_deducted, state) on public.visits to authenticated;
