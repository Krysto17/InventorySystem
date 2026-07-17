-- ─── Delete a cost-price computation (before it's an approved sale) ──────────
-- The general manager (or owner) can remove a saved computation or a
-- pending/rejected batch. An APPROVED batch is a completed sale that already
-- removed stock, so it stays. Run lots cascade on delete.

create policy "cost_price_runs: owner/gm delete unapproved"
  on public.cost_price_runs for delete to authenticated
  using (
    (public.is_owner() or public.is_general_manager())
    and approval_status is distinct from 'approved'
  );
