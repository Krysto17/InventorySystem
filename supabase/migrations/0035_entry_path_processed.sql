-- ─── Blueprint reconciliation: rename entry_path 'pre_processed' → 'processed' ─
-- The two intake paths are 'unprocessed' (→ plant) and 'processed' (material
-- already processed → straight to receiving). "pre_processed" was an awkward
-- term; the business calls it "processed".

alter table public.visits drop constraint if exists visits_entry_path_check;
update public.visits set entry_path = 'processed' where entry_path = 'pre_processed';
alter table public.visits
  add constraint visits_entry_path_check check (entry_path in ('unprocessed', 'processed'));
