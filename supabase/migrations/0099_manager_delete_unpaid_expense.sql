-- ─── Manager may delete an expense before it is paid ─────────────────────────
-- Previously only the general manager could delete a consumable (any status).
-- The site manager (own site) — and owner / general manager anywhere — may now
-- delete an expense, but only while it has NOT been paid. A paid expense is a
-- financial record and can no longer be removed.

drop policy if exists "consumables: general manager writes cross-site (delete)" on public.consumables;

create policy "consumables: manager/owner delete unpaid"
  on public.consumables for delete to authenticated
  using (
    approval_status <> 'paid'
    and (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'manager' and site_id = public.current_site())
    )
  );
