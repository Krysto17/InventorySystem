-- ─── Manager deletes a pending advance + advance carries an account number ────
-- A manager may delete an advance they recorded while it is still pending (the
-- owner hasn't approved it). The owner may delete any. Advances also carry an
-- optional account number (where the advance is to be paid).

alter table public.advances
  add column if not exists account_number text;

create policy "advances: manager deletes own-site pending, owner any"
  on public.advances for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'manager'
        and site_id = public.current_site()
        and approval_status = 'pending')
  );
