-- Sites are reference data needed by every authenticated role for display/dropdowns.
-- Read access is unrestricted for authenticated users; writes still require service role.
create policy "authenticated users can read sites" on public.sites
  for select to authenticated using (true);
