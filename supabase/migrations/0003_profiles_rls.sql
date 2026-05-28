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

-- Column-level privilege hardening: prevent authenticated users from updating
-- any sensitive column from the client. The RLS policy above restricts WHICH
-- row a user can touch; these REVOKE/GRANT statements restrict WHICH columns.
-- Without this, a logged-in user could run:
--   UPDATE profiles SET role = 'owner' WHERE id = auth.uid()
-- and bypass role-based access controls entirely.
-- Only must_change_password is client-updatable (users clear it on first login).
-- All other columns (role, site_id, status, etc.) are service-role only.
revoke update on public.profiles from authenticated;
grant update (must_change_password) on public.profiles to authenticated;
