-- ─── The notification bell in one round-trip ────────────────────────────────
-- The bell ran a separate count query per item — seven of them for the owner,
-- on every navigation, blocking the layout. And realtime re-ran the whole set
-- in every open tab whenever anyone wrote to any of nine tables.
--
-- One function, one row, counted the way the viewer is allowed to see it: this
-- is SECURITY INVOKER, so each count is still scoped by the same RLS policies
-- the pages use. A site manager counts their own site; the owner counts all.

create or replace function public.my_pending_counts()
  returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'prices_to_approve',   (select count(*) from public.visits where state = 'awaiting_price_approval'),
    'bulk_sales',          (select count(*) from public.bulk_sales where approval_status = 'pending'),
    'lot_sales',           (select count(*) from public.lot_sales where approval_status = 'pending'),
    'advances_pending',    (select count(*) from public.advances where approval_status = 'pending'),
    'expenses_pending',    (select count(*) from public.consumables where approval_status = 'pending'),
    'cost_runs',           (select count(*) from public.cost_price_runs where approval_status = 'pending'),
    'payments_pending',    (select count(*) from public.payments where status = 'pending'),
    'settlements_to_pay',  (select count(*) from public.batch_settlements where status = 'approved'),
    'advances_to_pay',     (select count(*) from public.advances where approval_status = 'approved'),
    'expenses_to_pay',     (select count(*) from public.consumables where approval_status = 'approved'),
    'passes_to_ack',       (select count(*) from public.gate_passes where status = 'issued'),
    'in_processing',       (select count(*) from public.visits where state = 'in_processing'),
    'in_receiving',        (select count(*) from public.visits where state = 'in_receiving'),
    'in_qc',               (select count(*) from public.visits where state = 'in_qc'),
    'in_pricing',          (select count(*) from public.visits where state = 'pricing'),
    'awaiting_gate_exit',  (select count(*) from public.visits where state = 'awaiting_gate_exit'),
    'awaiting_intake',     (select count(*) from public.visits where state = 'awaiting_stock_intake')
  ));
$$;

comment on function public.my_pending_counts is
  'Every "awaiting your action" count for the caller in one row, RLS-scoped.';

grant execute on function public.my_pending_counts() to authenticated;
