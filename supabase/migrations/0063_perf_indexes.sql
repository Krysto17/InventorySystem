-- ─── Performance indexes (#10) ───────────────────────────────────────────────
-- The QC "My analyses" sheet (#9) and the QC "done" list (#14) filter
-- xrf_records by recorded_by; index it. Also index the restrict-FK lookup
-- columns delete_batch (#4/#5) scans by visit.
create index if not exists xrf_records_recorded_by_idx
  on public.xrf_records (recorded_by);

create index if not exists advance_deductions_ref_visit_idx
  on public.advance_deductions (ref_visit_id);

create index if not exists stock_movements_ref_visit_idx
  on public.stock_movements (ref_visit_id);
