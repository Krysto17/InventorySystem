-- ─── Intake split: processing owns UNPROCESSED, receiving owns PROCESSED (#3) ──
-- Unprocessed material goes through the plant first, so processing creates those
-- visits (→ in_processing). Pre-processed material skips the plant, so receiving
-- creates those visits directly (→ in_receiving). Owner may create either.

drop policy if exists "visits: processing inserts own site" on public.visits;

create policy "visits: processing inserts unprocessed own site"
  on public.visits for insert to authenticated
  with check (
    public.current_role() = 'processing'
    and site_id = public.current_site()
    and entry_path = 'unprocessed'
    and state = 'in_processing'
  );

create policy "visits: receiving inserts processed own site"
  on public.visits for insert to authenticated
  with check (
    public.current_role() = 'receiving'
    and site_id = public.current_site()
    and entry_path = 'processed'
    and state = 'in_receiving'
  );

create policy "visits: owner inserts any"
  on public.visits for insert to authenticated
  with check (public.is_owner());
