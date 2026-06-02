create table public.machines (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id),
  name          text not null,
  charge_basis  text not null check (charge_basis in ('weight','bag','hour')),
  rate          numeric(12,2) not null check (rate >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (site_id, name)
);

create index machines_site_idx on public.machines (site_id);

alter table public.machines enable row level security;

-- Non-owner: read own site only
create policy "machines: read own site"
  on public.machines
  for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Owner-only writes
create policy "machines: owner inserts"
  on public.machines
  for insert to authenticated
  with check (public.is_owner());

create policy "machines: owner updates"
  on public.machines
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "machines: owner deletes"
  on public.machines
  for delete to authenticated
  using (public.is_owner());
