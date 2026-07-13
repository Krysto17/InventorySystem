-- ─── Expenses carry payee bank details ──────────────────────────────────────
-- Like advances, an expense (consumable) can now record where it is to be paid:
-- account name, account number and bank name travel with the expense so the
-- accountant has the payment details when it is approved.

alter table public.consumables
  add column if not exists account_name   text,
  add column if not exists account_number text,
  add column if not exists bank_name      text;
