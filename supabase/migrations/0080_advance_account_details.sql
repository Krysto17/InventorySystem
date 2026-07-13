-- ─── Advances carry full bank details ───────────────────────────────────────
-- Recording an advance already captured the account number; add the account
-- name and bank name so the payee's full details travel with the advance.

alter table public.advances
  add column if not exists account_name text,
  add column if not exists bank_name    text;
