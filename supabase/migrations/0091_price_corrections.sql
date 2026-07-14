-- ─── Price corrections on a paid visit ──────────────────────────────────────
-- A supplier's material may turn out over- or under-priced after they've been
-- paid. The paid settlement is a locked historical record — instead, record a
-- correction entry (owner / general manager) for the difference, tied to the
-- visit, for the audit trail. Settlement of the difference is handled manually.

create table public.price_corrections (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  site_id     uuid not null references public.sites(id),
  direction   text not null check (direction in ('overpaid', 'underpaid')),
  amount      numeric(14,2) not null check (amount > 0),
  reason      text,
  recorded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index price_corrections_visit_idx on public.price_corrections(visit_id, created_at);
create index price_corrections_supplier_idx on public.price_corrections(supplier_id);

alter table public.price_corrections enable row level security;

-- Read: finance roles (owner/accounting/manager); owner/accounting + general
-- manager see all sites, a site manager sees their own.
create policy "price_corrections: finance roles read"
  on public.price_corrections for select to authenticated
  using (
    public.current_role() in ('owner', 'accounting', 'manager')
    and (site_id = public.current_site() or public.has_cross_site_read())
  );

-- Recorded only through the RPC (SECURITY DEFINER) below, which enforces the
-- owner/general-manager check and that the visit was actually paid.
create or replace function public.record_price_correction(
  p_visit_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_supplier uuid; v_status text; v_id uuid;
begin
  if not (public.is_owner() or public.is_general_manager()) then
    raise exception 'only the owner or general manager may record a price correction';
  end if;
  if p_direction not in ('overpaid', 'underpaid') then
    raise exception 'direction must be overpaid or underpaid';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'correction amount must be greater than zero';
  end if;
  select v.site_id, v.supplier_id, bs.status
    into v_site, v_supplier, v_status
    from public.visits v
    left join public.batch_settlements bs on bs.visit_id = v.id
    where v.id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if v_status is distinct from 'paid' then
    raise exception 'a price correction applies only to a paid settlement';
  end if;
  insert into public.price_corrections (visit_id, supplier_id, site_id, direction, amount, reason, recorded_by)
  values (p_visit_id, v_supplier, v_site, p_direction, p_amount, nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.record_price_correction(uuid, text, numeric, text) to authenticated;
