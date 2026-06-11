-- ─── Phase 9 (A): QC role ────────────────────────────────────────────────────
-- Adds a dedicated `qc` role that owns the XRF analysis step (separate from the
-- receiving role's magnetic analysis). Unlike the Phase-7 gate *removal* (which
-- could not drop an enum value without CASCADE-dropping every RLS policy),
-- *adding* an enum value is safe and non-destructive.
--
-- The value is only added here; it is first *used* by later Phase-9 migrations
-- (0020 XRF records RLS, 0019 visit state machine), which run in their own
-- transactions, so the PG "can't use a new enum value in the same transaction"
-- restriction does not apply.

alter type public.app_role add value if not exists 'qc' after 'receiving';
