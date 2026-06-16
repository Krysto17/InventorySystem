create extension if not exists pg_trgm;

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

create index suppliers_phone_idx on public.suppliers (phone);
create index suppliers_name_idx  on public.suppliers using gin (name gin_trgm_ops);

alter table public.suppliers enable row level security;

-- Any authenticated user can read (global lookup)
create policy "suppliers: read for authenticated"
  on public.suppliers
  for select to authenticated
  using (true);

-- Any authenticated user can insert (gate adds new on the fly)
create policy "suppliers: insert for authenticated"
  on public.suppliers
  for insert to authenticated
  with check (auth.uid() is not null);

-- Only owner can update/delete
create policy "suppliers: owner updates"
  on public.suppliers
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "suppliers: owner deletes"
  on public.suppliers
  for delete to authenticated
  using (public.is_owner());
