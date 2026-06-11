-- ─── Phase 9 (F): Supplier advances ─────────────────────────────────────────
-- A standalone ledger of cash advances paid to suppliers. Recorded normally by
-- the manager; approved by the owner, manager, or accountant. Advances are NOT
-- auto-netted against any visit's purchase amount (per "this is not a full
-- financial system") — they are tracked and reported, and the owner reconciles
-- manually. Advances attach to the GLOBAL supplier, but carry a site_id (the
-- recording site) so lane isolation works like the rest of the app.

create table public.advances (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers(id),
  site_id         uuid not null references public.sites(id),
  purpose         text not null,
  amount_naira    numeric(14,2) not null check (amount_naira > 0),
  recorded_by     uuid references public.profiles(id),
  approval_status text not null default 'pending'
                    check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  rejection_note  text,
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index advances_site_status_idx on public.advances (site_id, approval_status);
create index advances_supplier_idx    on public.advances (supplier_id);

-- Stamp approved_at / approved_by audit columns when status leaves 'pending'.
create or replace function public._advances_before_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.approval_status <> OLD.approval_status
     and NEW.approval_status in ('approved', 'rejected') then
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger t_advances_before_update
  before update on public.advances
  for each row execute function public._advances_before_update();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.advances enable row level security;

create policy "advances: read own site"
  on public.advances for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Insert: manager (primarily), accountant, or owner — on their own site.
create policy "advances: manager/accountant insert own site"
  on public.advances for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and site_id = public.current_site()
    )
  );

-- Approve / reject: owner, manager, or accountant — on their own site.
create policy "advances: owner/manager/accountant update own site"
  on public.advances for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and site_id = public.current_site()
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() in ('manager', 'accounting')
      and site_id = public.current_site()
    )
  );
