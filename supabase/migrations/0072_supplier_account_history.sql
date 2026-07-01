-- ─── Supplier bank-account history ───────────────────────────────────────────
-- A supplier's account details (name / number / bank) stay editable, but each
-- time they change the previous set is kept, tagged to the supplier — so a
-- history of every account used is preserved (mirrors former_names for the name).

alter table public.suppliers
  add column if not exists former_accounts jsonb not null default '[]'::jsonb;

create or replace function public._suppliers_track_rename()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Name history.
  if NEW.name is distinct from OLD.name then
    NEW.former_names := array_append(OLD.former_names, OLD.name);
  end if;

  -- Account history: when the account details change and the old set had an
  -- account number, snapshot the old one into former_accounts.
  if OLD.account_number is not null
     and (NEW.account_number is distinct from OLD.account_number
          or NEW.account_name  is distinct from OLD.account_name
          or NEW.bank_name     is distinct from OLD.bank_name) then
    NEW.former_accounts := OLD.former_accounts || jsonb_build_object(
      'account_name',   OLD.account_name,
      'account_number', OLD.account_number,
      'bank_name',      OLD.bank_name,
      'replaced_at',    now()
    );
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;
