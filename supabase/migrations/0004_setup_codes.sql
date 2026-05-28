-- Records each provisioning event for audit. The temp password itself is NOT stored;
-- only a record that an account was created and whether it has been used (logged in).
create table public.setup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  role public.app_role not null,
  site_id uuid references public.sites(id),
  created_by uuid not null references auth.users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.setup_codes enable row level security;

create policy "owner reads setup codes" on public.setup_codes
  for select using (public.is_owner());
-- Inserts happen via service-role provisioning only (bypasses RLS).
