-- ─── General accountant = the New-Site accountant ───────────────────────────
-- Mirrors the general manager: the New-Site accountant is the central accountant
-- with cross-site reach — they see every site's finances and pay every site's
-- transactions. An accountant at any other site stays scoped to their own site.

create or replace function public.is_general_accountant()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_role() = 'accounting'
    and public.current_site() = (select id from public.sites where name = 'New-Site' limit 1),
    false);
$$;

grant execute on function public.is_general_accountant() to authenticated;

-- Cross-site READ now belongs to the owner, the general manager and the general
-- accountant — not every accountant.
create or replace function public.has_cross_site_read()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_role() = 'owner'
    or public.is_general_manager()
    or public.is_general_accountant(),
    false);
$$;

-- Cross-site PAY (approved → paid) belongs to the general accountant, replacing
-- the blanket "any accountant" policies added in 0084. The per-table transition
-- triggers still enforce the legal approved → paid step.
drop policy if exists "batch_settlements: accountant pays cross-site" on public.batch_settlements;
create policy "batch_settlements: general accountant pays cross-site"
  on public.batch_settlements for update to authenticated
  using (public.is_general_accountant()) with check (public.is_general_accountant());

drop policy if exists "advances: accountant pays cross-site" on public.advances;
create policy "advances: general accountant pays cross-site"
  on public.advances for update to authenticated
  using (public.is_general_accountant()) with check (public.is_general_accountant());

drop policy if exists "consumables: accountant pays cross-site" on public.consumables;
create policy "consumables: general accountant pays cross-site"
  on public.consumables for update to authenticated
  using (public.is_general_accountant()) with check (public.is_general_accountant());
