-- ─── Batch settlement: assemble → owner approval → accountant payment ────────
-- A supplier's batch supply (one visit, many material lines) is settled as a
-- unit: the manager assembles the payout —
--   net_balance = materials_total − light_bill_total − advance_deducted
-- where light_bill_total is the processing/utility ("light bill") charge for
-- the visit and advance_deducted is how much approved supplier debt is recovered
-- from this batch (partial or full). The manager submits it; the OWNER gives
-- final approval; the ACCOUNTANT then pays. remaining_debt records the
-- supplier's outstanding advance balance after this batch's deduction.

create table public.batch_settlements (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null unique references public.visits(id) on delete cascade,
  site_id           uuid not null references public.sites(id),
  materials_total   numeric(14,2) not null default 0,
  light_bill_total  numeric(14,2) not null default 0,
  advance_deducted  numeric(14,2) not null default 0,
  net_balance       numeric(14,2) not null default 0,
  remaining_debt    numeric(14,2) not null default 0,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'paid')),
  rejection_note    text,
  submitted_by      uuid references public.profiles(id),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  paid_by           uuid references public.profiles(id),
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index batch_settlements_site_status_idx on public.batch_settlements (site_id, status);

-- Status lifecycle + who may take each edge (owner approves; accountant pays).
create or replace function public._batch_settlements_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.status = OLD.status then
    NEW.updated_at := now();
    return NEW;
  end if;

  if OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if not public.is_owner() then
      raise exception 'only the owner approves or rejects a batch settlement';
    end if;
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
  elsif OLD.status = 'approved' and NEW.status = 'paid' then
    if not (public.is_owner() or public.current_role() = 'accounting') then
      raise exception 'only accounting or the owner can mark a settlement paid';
    end if;
    NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
    NEW.paid_at := coalesce(NEW.paid_at, now());
  else
    raise exception 'illegal batch settlement transition: % → %', OLD.status, NEW.status
      using errcode = '22000';
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger t_batch_settlements_transition
  before update on public.batch_settlements
  for each row execute function public._batch_settlements_transition();

-- Audit insert + status changes into the visit's transaction_events timeline.
create or replace function public._batch_settlements_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.submitted_by,
            jsonb_build_object('table', 'batch_settlements', 'record_id', NEW.id,
                               'net_balance', NEW.net_balance));
  elsif NEW.status is distinct from OLD.status then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_edited', auth.uid(),
            jsonb_build_object('table', 'batch_settlements', 'record_id', NEW.id,
                               'status', NEW.status));
  end if;
  return NEW;
end;
$$;

create trigger t_batch_settlements_after
  after insert or update on public.batch_settlements
  for each row execute function public._batch_settlements_after();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.batch_settlements enable row level security;

create policy "batch_settlements: read own site or cross-site reporter"
  on public.batch_settlements for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- Manager assembles + submits on its own site.
create policy "batch_settlements: manager submits own site"
  on public.batch_settlements for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

-- Owner (approve/reject, any site) + accountant (pay, own site) update; the
-- transition trigger enforces which status change each role may make.
create policy "batch_settlements: owner/accountant update"
  on public.batch_settlements for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'accounting' and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() = 'accounting' and site_id = public.current_site())
  );
