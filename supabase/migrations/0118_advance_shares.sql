-- ─── One customer collects an advance on behalf of several ──────────────────
-- A group often sends one person to collect a single advance, but each member
-- owes their own share. The advance still records WHO collected it; shares
-- apportion the DEBT to the others.
--
--   collector owes = advance amount − Σ shares apportioned away
--   each sharer owes = their share
-- so the parts always add back to the advance total — no money is created or
-- lost by splitting.

create table public.advance_shares (
  id          uuid primary key default gen_random_uuid(),
  advance_id  uuid not null references public.advances(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  amount      numeric(14,2) not null check (amount > 0),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (advance_id, supplier_id)
);
create index advance_shares_advance_idx  on public.advance_shares(advance_id);
create index advance_shares_supplier_idx on public.advance_shares(supplier_id);

alter table public.advance_shares enable row level security;

create policy "advance_shares: finance roles read"
  on public.advance_shares for select to authenticated
  using (
    exists (select 1 from public.advances a where a.id = advance_id
            and (a.site_id = public.current_site() or public.has_cross_site_read()))
  );

-- Manager (own site) / owner apportion the debt.
create policy "advance_shares: manager/owner write"
  on public.advance_shares for insert to authenticated
  with check (
    public.is_owner() or public.is_general_manager()
    or exists (select 1 from public.advances a where a.id = advance_id
               and public.current_role() = 'manager' and a.site_id = public.current_site())
  );
create policy "advance_shares: manager/owner delete"
  on public.advance_shares for delete to authenticated
  using (
    public.is_owner() or public.is_general_manager()
    or exists (select 1 from public.advances a where a.id = advance_id
               and public.current_role() = 'manager' and a.site_id = public.current_site())
  );

-- A share may never be given to the collector (that's their remainder), and the
-- shares can never exceed the advance.
create or replace function public._advance_shares_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_amount numeric; v_collector uuid; v_other numeric;
begin
  select amount_naira, supplier_id into v_amount, v_collector
    from public.advances where id = NEW.advance_id;
  if v_amount is null then raise exception 'advance not found'; end if;
  if NEW.supplier_id = v_collector then
    raise exception 'the collector keeps the remainder — do not add a share for them';
  end if;

  select coalesce(sum(amount), 0) into v_other
    from public.advance_shares
    where advance_id = NEW.advance_id and id <> NEW.id;

  if v_other + NEW.amount > v_amount + 0.005 then
    raise exception 'shares total %.2f exceed the advance of %.2f', v_other + NEW.amount, v_amount
      using errcode = '23514';
  end if;
  return NEW;
end; $$;

create trigger t_advance_shares_guard
  before insert or update on public.advance_shares
  for each row execute function public._advance_shares_guard();

-- Debt now follows the apportionment: the collector carries only what wasn't
-- shared away, and each sharer carries their own portion.
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select
    -- advances this supplier collected, less anything apportioned to others
    coalesce((
      select sum(a.amount_naira - coalesce((
        select sum(sh.amount) from public.advance_shares sh where sh.advance_id = a.id), 0))
      from public.advances a
      where a.supplier_id = _supplier_id and a.approval_status = 'paid'
    ), 0)
    -- plus shares of advances collected by someone else
    + coalesce((
      select sum(sh.amount)
      from public.advance_shares sh
      join public.advances a on a.id = sh.advance_id
      where sh.supplier_id = _supplier_id and a.approval_status = 'paid'
    ), 0)
    - coalesce((
      select sum(amount) from public.advance_deductions
      where supplier_id = _supplier_id and kind = 'advance'
    ), 0);
$$;
