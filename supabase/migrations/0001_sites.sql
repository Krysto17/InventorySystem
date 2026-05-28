create extension if not exists "pgcrypto";

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  created_at timestamptz not null default now()
);

alter table public.sites enable row level security;

-- Seed the three real sites.
insert into public.sites (name) values
  ('Site 1'), ('Site 2'), ('Site 3');
