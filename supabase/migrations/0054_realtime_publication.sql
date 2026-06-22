-- ─── Realtime: stream the tables that drive role queues / approvals ──────────
-- The header bell ("awaiting your action") and role queues recompute when any of
-- these tables change, so "needs approval" updates without a page reload. RLS
-- still applies to realtime, so each viewer only receives change events for rows
-- they're allowed to see (owner sees all; others are site-scoped).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'visits', 'gate_passes', 'bulk_sales', 'lot_sales', 'advances',
    'consumables', 'cost_price_runs', 'batch_settlements', 'payments'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
