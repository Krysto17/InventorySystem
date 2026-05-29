create table public.material_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

alter table public.material_types enable row level security;

-- Anyone authenticated may read
create policy "material_types: read for authenticated"
  on public.material_types
  for select to authenticated
  using (true);

-- Owner-only writes
create policy "material_types: owner inserts"
  on public.material_types
  for insert to authenticated
  with check (public.is_owner());

create policy "material_types: owner updates"
  on public.material_types
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "material_types: owner deletes"
  on public.material_types
  for delete to authenticated
  using (public.is_owner());

-- Seed with the confirmed default list
insert into public.material_types (name) values
  ('Tin Ore'),
  ('Columbite'),
  ('Tantalite'),
  ('Lead Concentrate'),
  ('Zinc Concentrate');
