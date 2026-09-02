-- ─── /qc/analyses: let the LIMIT stop the joins ─────────────────────────────
-- The analyses screen asks for the 200 most recent XRF records belonging to the
-- signed-in analyst, each carrying its material, visit and supplier. Nothing
-- supplied the ORDER BY, so Postgres had to read every one of the analyst's
-- rows, join each of them four times — visit_materials, material_types, visits,
-- suppliers, each with its own RLS predicate — then top-N sort and throw away
-- everything past 200.
--
-- The cost is therefore paid per ROW OWNED, not per row displayed, and one
-- analyst has recorded every record in the system. Measured on a local database
-- seeded to 10,000 records for a single recorder, running as `authenticated`
-- with that analyst's JWT claims:
--
--   before   17,302 ms   Seq Scan, joins loop 10,000 times, top-N heapsort
--   after       341 ms   Index Scan, joins loop 200 times, no sort at all
--
-- Production sat at 1,235 ms over 1,193 records when this was measured, so the
-- 8-second statement_timeout that Supabase sets on `authenticated` was the
-- destination, not a hypothetical.
--
-- Column order is what makes it work: the equality predicate first, then the two
-- ORDER BY keys in their own directions, so the planner can walk the index in
-- output order and stop at 200.
--
-- An INCLUDE (visit_material_id) variant was tried and dropped: it did not
-- change the count query's plan, which is the one remaining linear read on this
-- page and is not solvable with an index.
--
-- NB: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so unlike
-- 0144-0147 this migration must NOT be wrapped in begin/commit, and its ledger
-- row has to be written as a separate statement. It takes no ACCESS EXCLUSIVE
-- lock, so reads and writes carry on while it builds.
create index concurrently if not exists xrf_records_recorded_by_recent_idx
  on public.xrf_records (recorded_by, created_at desc, id desc);

comment on index public.xrf_records_recorded_by_recent_idx is
  'Serves /qc/analyses: recorded_by = $1 ORDER BY created_at DESC, id DESC LIMIT n. Lets the limit terminate before the joins run.';
