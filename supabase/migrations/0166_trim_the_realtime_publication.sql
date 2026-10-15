-- 0166 — Stop publishing two tables nobody listens to
--
-- The project is over its Free-plan log allowance (1.52 GB against 1 GB), and
-- the database agrees about where the work is: `pg_stat_statements` puts
-- Realtime's WAL query at **8,828,673 calls and 15.6 hours** of execution time,
-- more than every other statement in the system combined. Realtime evaluates
-- RLS once per subscription entry per change, so that figure is driven by how
-- many tables are published and how many listeners each change has to be
-- checked against.
--
-- `supabase_realtime` publishes nine tables. The application subscribes to
-- seven of them (see NOTIFY_TABLES in AppShell). The two left over are:
--
--   bulk_sales  — published, never subscribed
--   lot_sales   — published, never subscribed, and the lot-sales workflow was
--                 retired in b8e58c8; nothing can insert into it any more
--
-- Every write to those two still went through the WAL pipeline and was offered
-- to every connected client, for nobody. Removing them changes no behaviour:
-- no channel listens to either table, and the pages that show them read over
-- REST like any other page.
--
-- This is a reduction, not a fix for the quota on its own — see the note in the
-- hardening register about the remaining fan-out on `visits`, which seven of
-- nine roles watch.

alter publication supabase_realtime drop table public.bulk_sales;
alter publication supabase_realtime drop table public.lot_sales;
