-- Read own profile.
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

-- Owner reads all profiles.
create policy "owner reads all profiles" on public.profiles
  for select using (public.is_owner());

-- Users can update only their own password-change flag / name.
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Inserts/role changes happen only via the service-role key (provisioning),
-- which bypasses RLS — so no INSERT policy is granted to normal users.
