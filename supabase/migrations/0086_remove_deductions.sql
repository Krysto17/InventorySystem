-- ─── Manager can remove an applied deduction (mistake correction) ────────────
-- Advance deductions and "other" utility deductions could only be deleted by the
-- general manager. Let a site manager / accounting (own site) and the owner
-- remove one to fix a mistake before the batch is paid.

create policy "advance_deductions: manager/accounting/owner delete own site"
  on public.advance_deductions for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role() in ('manager', 'accounting') and site_id = public.current_site())
  );

-- utility_charges has no site_id — scope via the visit + still-open, mirroring
-- the manager insert/adjust policies.
create policy "utility_charges: manager/owner delete own site while open"
  on public.utility_charges for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'manager'
        and exists (select 1 from public.visits v where v.id = utility_charges.visit_id and v.site_id = public.current_site())
        and public.visit_is_open(visit_id))
  );
