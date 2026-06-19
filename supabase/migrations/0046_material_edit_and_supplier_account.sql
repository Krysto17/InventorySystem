-- ─── Receiving may edit material type; manager records supplier account ──────

-- 1. Let the recording role change a line's material type before QC (the
--    existing update RLS already gates who/when; this adds the column grant).
grant update (material_type_id) on public.visit_materials to authenticated;

-- 2. Supplier bank/account details — captured by the manager before submitting
--    a supplier's batch settlement.
alter table public.suppliers
  add column if not exists account_name   text,
  add column if not exists account_number text,
  add column if not exists bank_name      text;

-- Suppliers were owner-update-only; allow the manager to update them too (the
-- UI only exposes the account fields). Owner keeps full update (incl. rename).
create policy "suppliers: manager updates"
  on public.suppliers for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');
