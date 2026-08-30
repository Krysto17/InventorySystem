-- ─── Audit remediation: M-06, L-01, L-02 ────────────────────────────────────
-- Three defence-in-depth tightenings. None of them closes a live hole — the
-- audit verified each was unreachable today — they remove the reliance on
-- something else staying true.

-- M-06. _recompute_cost_price_run is an internal helper for the cost-price
-- triggers. It was executable by any signed-in user for any run id, including
-- another site's, with no authorization check of its own. Triggers call it as
-- their definer, so revoking direct RPC access costs nothing.
revoke execute on function public._recompute_cost_price_run(uuid) from authenticated;
revoke execute on function public._recompute_cost_price_run(uuid) from anon;
revoke execute on function public._recompute_cost_price_run(uuid) from public;

-- L-01. Four policies were created without a TO clause, so they apply to the
-- Postgres `public` role — which includes `anon`. They are safe today only
-- because every predicate resolves through auth.uid()/is_owner(), both empty
-- for an anonymous caller. Naming the role means a future predicate that does
-- not reference auth.uid() cannot silently become anon-readable.
drop policy if exists "owner reads all profiles" on public.profiles;
create policy "owner reads all profiles"
  on public.profiles for select to authenticated
  using (public.is_owner());

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "owner reads setup codes" on public.setup_codes;
create policy "owner reads setup codes"
  on public.setup_codes for select to authenticated
  using (public.is_owner());

-- L-02. `authenticated` held table-level INSERT and DELETE on profiles. Both
-- are denied in practice because no policy admits them, but that is protection
-- by omission. The column-scoped UPDATE grant stays exactly as it is: it is
-- what stops a user rewriting their own role, and it is the strongest control
-- in the file.
revoke insert, delete on public.profiles from authenticated;

-- L-02b. `anon` still held the full Supabase default — select, insert, update
-- and delete on profiles. Retargeting the policies above to `authenticated`
-- leaves anon with no policy at all, so RLS already denies every one of these;
-- but the whole point of this file is to stop depending on a second mechanism
-- staying true. Nothing signed-out reads or writes this table: sign-in resolves
-- a username to a synthetic email as a pure string transform and never queries
-- profiles, every other read is keyed on an established session, and both
-- writes (provisioning, status changes) go through the service-role client.
--
-- service_role is untouched — it is what provisioning runs as.
revoke select, insert, update, delete on public.profiles from anon;
