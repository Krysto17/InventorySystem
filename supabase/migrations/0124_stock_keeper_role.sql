-- ─── The store keeper gets their own login ──────────────────────────────────
-- Whoever actually stands in the store counts what is on the shelf. They see
-- the stocked materials and nothing else, and confirm each one is physically
-- there — or raise a dispute when it is missing or the weight is off.
--
-- The enum value lands on its own: Postgres will not let a value added in one
-- transaction be used in the same one, so the policies that reference it live
-- in the next migration.

alter type public.app_role add value if not exists 'stock_keeper';
