-- ─── Per-site totals come from SQL, and the hot lookups get their indexes ───
-- The cross-site report pulled every lot, advance and payment row into the page
-- and added them up in JavaScript. That is the pattern that quietly broke the
-- stock figures once the ledger passed PostgREST's 1000-row cap (0121), and it
-- ships thousands of rows to compute six numbers per site.

drop view if exists public.site_rollups;
create view public.site_rollups as
  select s.id as site_id,
         s.name as site_name,
         coalesce(l.available_kg, 0)      as available_lot_kg,
         coalesce(l.lot_value, 0)         as lot_value,
         coalesce(a.pending_advances, 0)  as pending_advances,
         coalesce(p.fee_in, 0)            as fee_in,
         coalesce(p.paid_out, 0)          as paid_out
    from public.sites s
    left join (
      select site_id,
             sum(weight_kg) as available_kg,
             sum(weight_kg * coalesce(cost_price_per_kg, 0)) as lot_value
        from public.stock_lots where status = 'available' group by site_id
    ) l on l.site_id = s.id
    left join (
      select site_id, sum(amount_naira) as pending_advances
        from public.advances where approval_status = 'pending' group by site_id
    ) a on a.site_id = s.id
    left join (
      select v.site_id,
             sum(pm.amount) filter (where pm.direction <> 'purchase_amount_out') as fee_in,
             sum(pm.amount) filter (where pm.direction =  'purchase_amount_out') as paid_out
        from public.payments pm join public.visits v on v.id = pm.visit_id
       group by v.site_id
    ) p on p.site_id = s.id
   where public.is_owner() or public.has_cross_site_read();

comment on view public.site_rollups is
  'Per-site stock and money totals for the cross-site report. Cross-site readers only.';

grant select on public.site_rollups to authenticated;

-- Every list page reads newest-first, and the audit trail is read per visit in
-- time order. Small tables today, but these are the paths that grow forever.
create index if not exists visits_created_at_idx
  on public.visits (created_at desc);
create index if not exists visits_state_created_idx
  on public.visits (state, created_at desc);
create index if not exists transaction_events_visit_created_idx
  on public.transaction_events (visit_id, created_at);
create index if not exists payments_visit_idx
  on public.payments (visit_id);
