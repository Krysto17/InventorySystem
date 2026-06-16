-- ─── Phase 11 (D): Payment receipts — Supabase Storage ───────────────────────
-- First use of Storage. Receipts live in a PRIVATE bucket; per the blueprint
-- they are visible only to the accountant, the manager, and the owner
-- (director). Receiving / processing / qc / inventory can neither upload nor
-- read them. The uploaded object's path is recorded on the payment row.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

alter table public.payments
  add column receipt_path text;

-- Storage RLS (storage.objects already has RLS enabled by Supabase).
create policy "receipts: accounting/owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.current_role() in ('accounting', 'owner')
  );

create policy "receipts: accounting/manager/owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.current_role() in ('accounting', 'manager', 'owner')
  );
