-- ─── Visit intake belongs to processing again ───────────────────────────────
-- 0049 let the gate create visits (the Phase 1/2 at-gate intake). Intake now
-- moves back to the processing role; the gate keeps its UPDATE rights (it still
-- releases no-agreement visits awaiting_gate_exit → exited).

drop policy if exists "visits: gate/processing insert own site" on public.visits;
create policy "visits: processing inserts own site"
  on public.visits for insert to authenticated
  with check (
    (public.current_role() = 'processing' and site_id = public.current_site())
    or public.is_owner()
  );
