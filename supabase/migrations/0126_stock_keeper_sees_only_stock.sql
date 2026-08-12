-- ─── The store keeper's login is the store, and nothing else ────────────────
-- Most tables let any role posted to a site read that site's rows. A new role
-- therefore inherits the lot: settlements, payouts, advances, supplier bank
-- details. The keeper counts material — none of that is their business.
--
-- One RESTRICTIVE policy per sensitive table walls them off. Restrictive
-- policies AND with the permissive ones, and this predicate is true for every
-- other role, so nobody else's access changes.
do $$
declare t text;
begin
  foreach t in array array[
    -- money
    'advances', 'advance_deductions', 'advance_shares', 'batch_settlements',
    'settlement_payments', 'settlement_payout_splits', 'payments', 'pricing',
    'price_corrections', 'utility_charges', 'consumables', 'cost_price_runs',
    -- the inbound workflow and its records
    'visits', 'visit_materials', 'xrf_records', 'analysis_records',
    'sample_analyses', 'processing_records', 'processing_machine_usage',
    'batch_comments', 'transaction_events',
    -- selling, gate paperwork, and supplier bank details
    'bulk_sales', 'lot_sales', 'lot_sale_items', 'suppliers',
    'gate_passes', 'gate_logs', 'gate_exit_authorizations'
  ]
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', 'not for the store keeper', t);
    execute format(
      'create policy %I on public.%I as restrictive to authenticated '
      'using (public.current_role()::text <> ''stock_keeper'') '
      'with check (public.current_role()::text <> ''stock_keeper'')',
      'not for the store keeper', t);
  end loop;
end $$;
