-- ─── Per-batch processing-fee discount (#7) ──────────────────────────────────
-- The processing user may apply a percentage discount to the processing fee for
-- a batch. The light-bill charge is stored net of the discount (everyone sees
-- the net fee); the discount percentage itself is recorded here and surfaced in
-- the UI to managers + owner only.

alter table public.processing_records
  add column if not exists discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100);
