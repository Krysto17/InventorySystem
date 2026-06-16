create type public.app_role as enum (
  'gate', 'processing', 'receiving', 'manager', 'accounting', 'inventory', 'owner'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text not null unique,
  role public.app_role not null,
  site_id uuid references public.sites(id),  -- null only for owner (cross-site)
  status text not null default 'active' check (status in ('active', 'disabled')),
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint owner_has_no_site check (role <> 'owner' or site_id is null),
  constraint non_owner_has_site check (role = 'owner' or site_id is not null)
);

alter table public.profiles enable row level security;

-- Helper: current user's role, used by RLS across the whole app.
create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Helper: current user's site.
create or replace function public.current_site()
returns uuid
language sql stable security definer set search_path = public as $$
  select site_id from public.profiles where id = auth.uid();
$$;

-- Helper: is the current user the owner?
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'owner', false);
$$;
