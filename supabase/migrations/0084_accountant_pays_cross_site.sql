-- ─── The accountant pays across sites ───────────────────────────────────────
-- Accounting is a cross-site role (cross-site read; the payouts queue lists
-- every site's approved items). But the update policies restricted the
-- accountant to their own site, so "Mark paid" on another site's settlement /
-- advance / expense silently updated 0 rows and appeared to do nothing.
-- Allow the accountant to update these cross-site; the per-table transition
-- triggers still enforce the legal approved → paid transition and role, so this
-- only enables the payment action, nothing more.

create policy "batch_settlements: accountant pays cross-site"
  on public.batch_settlements for update to authenticated
  using (public.current_role() = 'accounting')
  with check (public.current_role() = 'accounting');

create policy "advances: accountant pays cross-site"
  on public.advances for update to authenticated
  using (public.current_role() = 'accounting')
  with check (public.current_role() = 'accounting');

create policy "consumables: accountant pays cross-site"
  on public.consumables for update to authenticated
  using (public.current_role() = 'accounting')
  with check (public.current_role() = 'accounting');
