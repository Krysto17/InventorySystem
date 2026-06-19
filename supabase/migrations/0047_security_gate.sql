-- ─── Security role (the gate) ────────────────────────────────────────────────
-- Adds the `security` role. It is first USED by 0048 (a separate transaction),
-- per Postgres' "can't use a new enum value in the same transaction" rule.
alter type public.app_role add value if not exists 'security' after 'inventory';
