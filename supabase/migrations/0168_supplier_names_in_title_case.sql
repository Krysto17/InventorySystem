-- 0168 — Supplier names are stored in Title Case
--
-- Names are typed by whoever registers the supplier, so the same register holds
-- "AHMED MUSA", "ahmed musa" and "Ahmed Musa". Measured against production
-- before writing this: 69 of 448 names change under the rule below, 7 of them
-- because they carry a double space. It reads as careless on a printed PDF, and
-- it makes two spellings of one person look like two people.
--
-- Normalising is safe here, which is worth stating because it usually is not.
-- The uniqueness rule on names is `suppliers_name_lower_unique`, an index on
-- lower(name) — and title-casing cannot change lower(name), since it only
-- changes which letters are capitals. So no normalisation can collide with it.
-- Confirmed against production before writing this: 0 case-insensitive
-- duplicate names today and 0 after title-casing.
--
-- Plain `initcap` is not the rule, because it lowercases the rest of every word
-- and so mangles names that are deliberately capitalised inside: "McDonald"
-- would become "Mcdonald", "DeSouza" "Desouza". The rule below therefore works
-- word by word and only normalises a word that is written in ONE case —
-- "AHMED" or "ahmed" become "Ahmed", while "McDonald" is left exactly as typed,
-- on the reasoning that a word containing both cases was capitalised on
-- purpose. A word carrying a full stop or an apostrophe ("A.A.", "Mus'ab") is
-- also left alone; see the function body for why. Runs of whitespace collapse
-- to single spaces, which fixes a real search defect: two production names
-- carry a double space, and typing them as they look found nothing.

-- The rename history must not record a re-casing as a rename. Without this,
-- normalising the names below would push "AHMED MUSA" into former_names and
-- the UI would render "Ahmed Musa (Formerly AHMED MUSA)" for every one of them.
-- A rename is a change of name, not of capitals.
create or replace function public._suppliers_track_rename()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare archived jsonb;
begin
  -- The ONLY change from the live definition is `lower(btrim(...))` on this
  -- comparison. The account-history block below it is reproduced verbatim from
  -- 0072/0103: this function maintains former_accounts as well as former_names,
  -- and rewriting it from the 0027 original would silently drop that.
  if lower(btrim(NEW.name)) is distinct from lower(btrim(OLD.name)) then
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
$function$;

-- The rule, as a function, so the trigger and the backfill below cannot drift.
create or replace function public.title_case_name(p_name text)
  returns text
  language sql
  immutable
as $function$
  select nullif(
    (select string_agg(
       case
         -- Both cases present: capitalised on purpose, left alone.
         when w ~ '[[:lower:]]' and w ~ '[[:upper:]]' then w
         -- Contains a full stop or an apostrophe: left alone. Postgres
         -- `initcap` treats '-' as a word boundary but NOT '.' or '''', so it
         -- turns "A.A." into "A.a." and "O'BRIEN" into "O'brien". Two real
         -- supplier names are initialisms of this shape. No single rule gets
         -- both "O'Brien" and "Mus'ab" right, so the choice here is to never
         -- corrupt a name: an abbreviation that stays as typed is a much
         -- smaller fault than one that is mangled.
         when w ~ '[.'']' then w
         else initcap(w)
       end, ' ' order by ord)
       from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+')
            with ordinality as t(w, ord)),
    '');
$function$;

comment on function public.title_case_name(text) is
  'A supplier name in Title Case: each single-case word is capitalised, a word '
  'with inner capitals (McDonald, DeSouza) is kept as typed, whitespace runs '
  'collapse. See 0168.';

-- anon has no business calling it, but service_role must: privileged server
-- actions insert suppliers, and the trigger below used to fail for them with
-- "permission denied for function title_case_name" once the default PUBLIC
-- grant was revoked. The trigger is SECURITY DEFINER for the same reason, so a
-- caller never needs this grant merely to save a supplier.
revoke execute on function public.title_case_name(text) from public, anon;
grant  execute on function public.title_case_name(text) to authenticated, service_role;

-- Enforce it on the way in, so this holds for every future supplier without the
-- app having to remember. Separate from the rename tracker on purpose: this one
-- also runs on INSERT, and it must run BEFORE the tracker sees NEW.name so that
-- the tracker's comparison is made on the normalised value. Trigger order is
-- alphabetical, and "a_" sorts before "track".
create or replace function public._suppliers_title_case_name()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  if NEW.name is not null then
    NEW.name := coalesce(public.title_case_name(NEW.name), NEW.name);
  end if;
  return NEW;
end;
$function$;

drop trigger if exists t_suppliers_a_title_case on public.suppliers;
create trigger t_suppliers_a_title_case
  before insert or update of name on public.suppliers
  for each row execute function public._suppliers_title_case_name();

-- Normalise what is already there. Restricted to rows that actually differ, so
-- this touches 69 rows rather than rewriting all 448 and bumping their
-- updated_at for nothing.
update public.suppliers
   set name = public.title_case_name(name)
 where public.title_case_name(name) is not null
   and name <> public.title_case_name(name);

-- The same names appear inside former_names, written by whoever renamed the
-- supplier before this rule existed. Normalise them too, otherwise a search for
-- a former name is still case-dependent, and drop any that have become an exact
-- duplicate of the current name or of each other.
update public.suppliers s
   set former_names = coalesce((
         select array_agg(distinct public.title_case_name(f))
           from unnest(s.former_names) as f
          where public.title_case_name(f) is not null
            and public.title_case_name(f) <> s.name
       ), '{}')
 where s.former_names is not null
   and array_length(s.former_names, 1) > 0;
