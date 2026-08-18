-- ─── Every account entered is remembered, wherever it was entered ───────────
-- Autofill was built by scraping three tables (suppliers, advances,
-- consumables) on every render of every page with an account form. Two places
-- that take account details were missing from that list — the payment ledger
-- and the payout-split plan — so an account typed while paying a settlement was
-- never offered again, and had to be retyped from the paper each time.
--
-- Instead of scraping more tables, the trio is captured where it is written: a
-- trigger on all five tables files a complete name+number+bank into one small
-- directory. Autofill then reads that directory, and adding a sixth place that
-- takes account details is one more trigger rather than a wider scrape.

create table if not exists public.bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  account_name   text not null,
  account_number text not null,
  bank_name      text not null,
  times_used     integer not null default 1,
  first_seen_at  timestamptz not null default now(),
  last_used_at   timestamptz not null default now()
);

-- One row per account. The same number under a differently-cased name is the
-- same account, so the key folds case.
create unique index if not exists bank_accounts_number_name_key
  on public.bank_accounts (account_number, lower(account_name));
create index if not exists bank_accounts_recent_idx
  on public.bank_accounts (last_used_at desc);

comment on table public.bank_accounts is
  'Directory of bank accounts used anywhere in the app. Written by trigger, read for autofill.';

-- Remember the trio behind whatever row was just written. Only a COMPLETE trio
-- is filed — a half-entered account is worse than none, because autofill would
-- then hand someone a number with the wrong bank.
create or replace function public._remember_bank_account()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_number text; v_bank text;
begin
  v_name   := nullif(btrim(NEW.account_name), '');
  v_number := nullif(btrim(NEW.account_number), '');
  v_bank   := nullif(btrim(NEW.bank_name), '');
  if v_name is null or v_number is null or v_bank is null then
    return NEW;
  end if;

  insert into public.bank_accounts (account_name, account_number, bank_name)
  values (v_name, v_number, v_bank)
  on conflict (account_number, lower(account_name)) do update
    set bank_name    = excluded.bank_name,
        times_used   = public.bank_accounts.times_used + 1,
        last_used_at = now();
  return NEW;
end; $$;

do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'advances', 'consumables',
    'settlement_payments', 'settlement_payout_splits'
  ]
  loop
    execute format('drop trigger if exists t_remember_bank_account on public.%I', t);
    execute format(
      'create trigger t_remember_bank_account after insert or update of account_name, account_number, bank_name '
      'on public.%I for each row execute function public._remember_bank_account()', t);
  end loop;
end $$;

-- Backfill from what has already been entered, so the directory starts full
-- rather than learning from scratch.
insert into public.bank_accounts (account_name, account_number, bank_name)
select distinct on (account_number, lower(account_name))
       btrim(account_name), btrim(account_number), btrim(bank_name)
  from (
    select account_name, account_number, bank_name from public.suppliers
    union all select account_name, account_number, bank_name from public.advances
    union all select account_name, account_number, bank_name from public.consumables
    union all select account_name, account_number, bank_name from public.settlement_payments
    union all select account_name, account_number, bank_name from public.settlement_payout_splits
  ) all_trios
 where nullif(btrim(account_name), '') is not null
   and nullif(btrim(account_number), '') is not null
   and nullif(btrim(bank_name), '') is not null
on conflict (account_number, lower(account_name)) do nothing;

alter table public.bank_accounts enable row level security;

-- Read is for the roles that actually fill in an account: the manager and owner
-- who plan payouts, the accountant who pays them, and inventory who logs
-- expenses. This is deliberately NARROWER than the old scrape — it never hands
-- an account number to a role that could not already see one.
drop policy if exists "bank_accounts: account-facing roles read" on public.bank_accounts;
create policy "bank_accounts: account-facing roles read"
  on public.bank_accounts for select to authenticated
  using (
    public.is_owner()
    or public.current_role()::text in ('manager', 'accounting', 'inventory')
  );

-- Writes only ever happen through the trigger, which runs as its definer.
grant select on public.bank_accounts to authenticated;
