-- ─── Switching a supplier's active account de-duplicates history ─────────────
-- Supplier account changes are archived into former_accounts. When you switch
-- BACK to a previously-used account, that account should leave the history (it's
-- the current one again) while the account it replaced is archived. Extend the
-- history trigger to drop any former entry that matches the new current account.

create or replace function public._suppliers_track_rename()
  returns trigger language plpgsql security definer set search_path = public as $$
declare archived jsonb;
begin
  if NEW.name is distinct from OLD.name then
    NEW.former_names := array_append(OLD.former_names, OLD.name);
  end if;

  if OLD.account_number is not null
     and (NEW.account_number is distinct from OLD.account_number
          or NEW.account_name  is distinct from OLD.account_name
          or NEW.bank_name     is distinct from OLD.bank_name) then
    archived := OLD.former_accounts || jsonb_build_object(
      'account_name',   OLD.account_name,
      'account_number', OLD.account_number,
      'bank_name',      OLD.bank_name,
      'replaced_at',    now()
    );
    -- Drop any history entry equal to the NEW (now current) account number, so
    -- switching back to an old account doesn't leave it duplicated in history.
    if NEW.account_number is not null then
      select coalesce(jsonb_agg(e), '[]'::jsonb) into NEW.former_accounts
      from jsonb_array_elements(archived) e
      where e ->> 'account_number' is distinct from NEW.account_number;
    else
      NEW.former_accounts := archived;
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;
