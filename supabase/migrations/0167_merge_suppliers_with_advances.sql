-- 0167 — A supplier carrying an advance can be merged, and candidates are
--        found by any name they have ever had
--
-- Three separate faults, all reported as "suppliers with an advance can't merge".
--
-- 1. THE MERGE FAILED OUTRIGHT. `merge_suppliers` (0115) reassigns eight foreign
--    keys by name. Since then 0118 added `advance_shares`, a ninth, and nobody
--    added it to the list. Its FK to suppliers is NO ACTION, so the merge did
--    all its work and then died on the final `delete from suppliers` with a
--    foreign_key_violation — and because the whole function is one transaction,
--    the entire merge rolled back. Any supplier who had been given a share of
--    someone else's advance, or who had collected an advance shared with
--    others, simply could not be merged. 21 share rows exist in production.
--
-- 2. A PAID OR APPROVED ADVANCE REFUSED TO CHANGE HANDS. Reassigning an advance
--    is an UPDATE on it, and two guards stand in the way. `_advances_before_update`
--    (0019) refuses any modification of a `paid` advance outright, and
--    `_approved_payable_freeze` (ST002, 0162) freezes `supplier_id` on an
--    `approved` or `on_hold` one. Both are right to exist and neither had a
--    merge in mind: an advance that has actually been disbursed is exactly the
--    kind a real supplier has, so in practice any supplier worth merging hit
--    one of them. This is the error the merge reported first, before it ever
--    reached the foreign key in fault (1).
--
-- 3. THE RIGHT DUPLICATE WAS NOT OFFERED. `find_similar_suppliers` compares the
--    search term against `suppliers.name` only. A supplier renamed from
--    "Musa Ahmed" to "Ahmed Musa" keeps the old name in `former_names`, where
--    nothing looked, so searching the name actually written on the old
--    paperwork found nothing.
--
-- Shares are not a column to drag across: they are a debt apportionment, and
-- the merge has to leave each supplier owing exactly what they owed. From 0118:
--
--     debt(S) = Σ (advances S collected − shares apportioned away)
--             + Σ (shares of other people's advances held by S)
--             − Σ (advance deductions for S)
--
-- so the merge must satisfy debt(keep after) = debt(keep before) + debt(dupe
-- before). Each of the four cases below is chosen to make that identity hold.

-- ── Let a merge, and only a merge, move an advance to another supplier ─────
-- The narrowest carve-out that works, following the transaction-local pattern
-- already used by `app.payable_review`, `app.ledger_payment` and
-- `app.visit_transition`: `merge_suppliers` raises a flag for the length of its
-- own transaction, and these two guards honour it for a change of `supplier_id`
-- and nothing else.
--
-- "Nothing else" is enforced, not trusted: both compare the whole row with
-- `supplier_id` removed and refuse if anything other than it differs. The
-- amount, the site, the account details, the approval status and the dates of a
-- paid advance stay as immutable as they were — a merge changes who owes the
-- money, never how much or whether it was paid. `updated_at` and `revision` are
-- excluded from the comparison because the later triggers in the chain set them.

create or replace function public._advances_before_update()
  returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if OLD.approval_status = 'paid' then
    -- A merge may re-point a paid advance at the surviving supplier. Anything
    -- else about a paid advance remains frozen.
    if not (coalesce(current_setting('app.supplier_merge', true), '') = 'on'
            and NEW.supplier_id is distinct from OLD.supplier_id
            and to_jsonb(NEW) - 'supplier_id' - 'updated_at' - 'revision'
                is not distinct from to_jsonb(OLD) - 'supplier_id' - 'updated_at' - 'revision') then
      raise exception 'a paid advance can no longer be modified';
    end if;
  end if;
  if NEW.approval_status is distinct from OLD.approval_status then
    if coalesce(current_setting('app.payable_review', true), '') = 'on'
       and ((OLD.approval_status = 'approved' and NEW.approval_status in ('on_hold', 'pending'))
         or (OLD.approval_status = 'on_hold' and NEW.approval_status in ('approved', 'pending'))) then
      null;
    elsif OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
      if auth.uid() is not null and not public.is_owner() then
        raise exception 'only the owner approves or rejects an advance';
      end if;
      NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
      NEW.approved_at := coalesce(NEW.approved_at, now());
    elsif OLD.approval_status = 'approved' and NEW.approval_status = 'paid' then
      if auth.uid() is not null
         and not (public.is_owner() or public.current_role() in ('accounting', 'manager')) then
        raise exception 'only the accountant, manager, or owner can mark an advance paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal advance transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $function$;

create or replace function public._approved_payable_freeze()
  returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  fields text[];
  f text;
  v_merging boolean;
begin
  if OLD.approval_status not in ('approved', 'on_hold') then
    return NEW;
  end if;

  -- A merge moving this advance to the surviving supplier: `supplier_id` comes
  -- off the frozen list, and only if nothing else about the row changed.
  -- Read supplier_id out of jsonb rather than as a field. This trigger is
  -- shared with `consumables`, which has no such column, and SQL does not
  -- promise to short-circuit an AND — so naming NEW.supplier_id directly
  -- raises undefined_column (42703) on every consumables update, whatever
  -- order the conditions are written in.
  v_merging := coalesce(current_setting('app.supplier_merge', true), '') = 'on'
    and TG_TABLE_NAME = 'advances'
    and to_jsonb(NEW) -> 'supplier_id' is distinct from to_jsonb(OLD) -> 'supplier_id'
    and to_jsonb(NEW) - 'supplier_id' - 'updated_at' - 'revision'
        is not distinct from to_jsonb(OLD) - 'supplier_id' - 'updated_at' - 'revision';

  -- Only the fields that decide how much money moves and to whom. The free-text
  -- description (`name` / `purpose`) and the notes are NOT frozen: they carry no
  -- money and no payee, and correcting the wording of an approved item is
  -- existing, legitimate behaviour.
  if TG_TABLE_NAME = 'consumables' then
    fields := array['amount_naira', 'site_id', 'category',
                    'account_name', 'account_number', 'bank_name'];
  elsif v_merging then
    fields := array['amount_naira', 'site_id',
                    'account_name', 'account_number', 'bank_name'];
  else
    fields := array['amount_naira', 'supplier_id', 'site_id',
                    'account_name', 'account_number', 'bank_name'];
  end if;

  foreach f in array fields loop
    if to_jsonb(NEW) -> f is distinct from to_jsonb(OLD) -> f then
      raise exception 'This approved record cannot be changed. Send it back or reopen it before editing.'
        using errcode = 'ST002';
    end if;
  end loop;
  return NEW;
end; $function$;

create or replace function public.merge_suppliers(p_keep uuid, p_duplicate uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_keep_name text; v_dupe_name text; v_dupe_former text[]; r record;
begin
  if not (public.is_owner() or public.is_general_manager()) then
    raise exception 'only the owner or general manager can merge suppliers';
  end if;
  if p_keep is null or p_duplicate is null or p_keep = p_duplicate then
    raise exception 'pick two different suppliers';
  end if;

  select name into v_keep_name from public.suppliers where id = p_keep;
  select name, former_names into v_dupe_name, v_dupe_former
    from public.suppliers where id = p_duplicate;
  if v_keep_name is null then raise exception 'supplier to keep not found'; end if;
  if v_dupe_name is null then raise exception 'duplicate supplier not found'; end if;

  -- A table was added once without this function noticing, which is fault (1)
  -- above. Check FIRST, before anything moves: once the updates have run, the
  -- delete fails on the foreign key and the whole transaction rolls back with
  -- an error that reads as "merging is broken" rather than "this function is
  -- out of date". Fail fast and say which it is.
  if exists (
    select 1 from pg_constraint c
     where c.contype = 'f'
       and c.confrelid = 'public.suppliers'::regclass
       and c.conrelid::regclass::text not in (
         'visits', 'advances', 'advance_deductions', 'advance_shares', 'gate_logs',
         'gate_passes', 'price_corrections', 'sample_analyses', 'stock_lots')
  ) then
    raise exception 'merge_suppliers is out of date: % also references suppliers and would be left behind',
      (select string_agg(distinct c.conrelid::regclass::text, ', ')
         from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'public.suppliers'::regclass
          and c.conrelid::regclass::text not in (
            'visits', 'advances', 'advance_deductions', 'advance_shares', 'gate_logs',
            'gate_passes', 'price_corrections', 'sample_analyses', 'stock_lots'))
      using errcode = 'MG001';
  end if;

  -- ── Reconcile the advance shares BEFORE anything moves ──────────────────
  -- Order matters throughout: `_advance_shares_guard` rejects a share held by
  -- the advance's own collector, and `unique (advance_id, supplier_id)` rejects
  -- two shares of one advance by one supplier. Both become reachable the moment
  -- two suppliers turn into one, so each case is cleared while the rows are
  -- still distinguishable.

  -- (1) The duplicate holds a share of an advance the SURVIVOR collected.
  -- Once they are one person that share is part of the collector's own
  -- remainder again, which is what deleting it means: the collector's
  -- remainder is `amount − Σ shares`, so removing a share of X raises it by
  -- exactly X. The duplicate stops owing X, the survivor starts owing X.
  delete from public.advance_shares sh
   using public.advances a
   where sh.advance_id = a.id
     and sh.supplier_id = p_duplicate
     and a.supplier_id  = p_keep;

  -- (2) The mirror image: the SURVIVOR holds a share of an advance the
  -- duplicate collected. That advance is about to become the survivor's, which
  -- would leave them holding a share of their own advance — precisely the state
  -- the guard forbids. Same arithmetic, so same resolution.
  delete from public.advance_shares sh
   using public.advances a
   where sh.advance_id = a.id
     and sh.supplier_id = p_keep
     and a.supplier_id  = p_duplicate;

  -- (3) Both hold a share of the same third party's advance. The unique
  -- constraint forbids keeping two rows, so the duplicate's amount folds into
  -- the survivor's. Done row by row, deleting BEFORE adding: the guard sums the
  -- other shares on the advance, and if the update ran first it would still
  -- count the duplicate's row and reject the total as exceeding the advance.
  for r in
    select d.id as dupe_share_id, d.advance_id, d.amount
      from public.advance_shares d
     where d.supplier_id = p_duplicate
       and exists (
         select 1 from public.advance_shares k
          where k.advance_id = d.advance_id and k.supplier_id = p_keep)
  loop
    delete from public.advance_shares where id = r.dupe_share_id;
    update public.advance_shares
       set amount = amount + r.amount
     where advance_id = r.advance_id and supplier_id = p_keep;
  end loop;

  -- (4) Whatever is left is a share of some third party's advance that only the
  -- duplicate holds, so it simply changes hands. The guard still checks it, and
  -- passes: cases 1 and 2 removed every row whose collector is either of these
  -- two, and 0118 already prevents a collector holding a share of their own
  -- advance, so the collector here is always someone else.
  update public.advance_shares set supplier_id = p_keep where supplier_id = p_duplicate;

  -- ── Move every remaining reference (the original eight) ─────────────────
  -- The flag is read by the two advance guards above and by nothing else. It is
  -- transaction-local, so it cannot leak past this call even on an exception,
  -- but it is lowered again below so no later statement in the same transaction
  -- rides on it.
  perform set_config('app.supplier_merge', 'on', true);

  update public.visits             set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.advances           set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.advance_deductions set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.gate_logs          set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.gate_passes        set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.price_corrections  set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.sample_analyses    set supplier_id = p_keep where supplier_id = p_duplicate;
  update public.stock_lots         set supplier_id = p_keep where supplier_id = p_duplicate;

  -- Keep the duplicate's name (and its own history) on the survivor. Set
  -- directly — the rename trigger only tracks name changes, not merges.
  update public.suppliers
     set former_names = (
           select array_agg(distinct n) from unnest(
             coalesce(former_names, '{}') || coalesce(v_dupe_former, '{}') || array[v_dupe_name]
           ) as n
           where n is not null and n <> v_keep_name
         )
   where id = p_keep;

  delete from public.suppliers where id = p_duplicate;

  perform set_config('app.supplier_merge', '', true);
end; $$;

comment on function public.merge_suppliers(uuid, uuid) is
  'Fold a duplicate supplier into another. Moves all nine supplier references, '
  'reconciling advance_shares so each side keeps the debt it had (see 0167), '
  'preserves the duplicate name in former_names, then deletes the duplicate.';

-- ── Find candidates by ANY name a supplier has ever had ────────────────────
-- Same signature and same result columns, so callers and the generated types
-- are untouched. Three widenings:
--   * every comparison now runs over `name` AND `former_names`
--   * a shared WORD of four or more letters counts as a match, which is what
--     catches "Madam Maria" against "Maria Dung" — the pair that motivated
--     0115 and that trigram similarity alone scores below its own threshold
--   * an exact hit on any name sorts above a merely similar one
create or replace function public.find_similar_suppliers(
  p_name text default null,
  p_account_number text default null,
  p_exclude uuid default null
)
returns table (
  id uuid, name text, supplier_code text,
  account_name text, account_number text, bank_name text,
  similarity real, same_account boolean
)
language sql stable security definer set search_path = public as $$
  with needle as (
    select btrim(coalesce(p_name, ''))         as q,
           btrim(coalesce(p_account_number, '')) as acct
  ),
  -- Words worth matching on. Three letters or fewer are initials and honorific
  -- fragments ("Mr", "Dr", "Nig"), which would match almost everyone.
  needle_words as (
    select distinct w
      from needle, lateral regexp_split_to_table(lower(needle.q), '[^[:alnum:]]+') as w
     where length(w) >= 4
  ),
  cand as (
    select s.id, s.name, s.supplier_code, s.account_name, s.account_number, s.bank_name,
           array[s.name] || coalesce(s.former_names, '{}') as all_names
      from public.suppliers s
     where p_exclude is null or s.id <> p_exclude
  ),
  scored as (
    select c.id, c.name, c.supplier_code, c.account_name, c.account_number, c.bank_name,
           (select (n.acct <> '' and c.account_number = n.acct) from needle n) as same_account,
           -- strongest name signal across every name this supplier has had
           (select coalesce(max(similarity(x, n.q)), 0)
              from unnest(c.all_names) x, needle n where n.q <> '') as sim,
           (select exists (
              select 1 from unnest(c.all_names) x, needle n
               where n.q <> '' and lower(btrim(x)) = lower(n.q))) as exact_name,
           (select exists (
              select 1 from unnest(c.all_names) x, needle n
               where n.q <> '' and length(n.q) >= 4
                 and (x ilike '%' || n.q || '%' or n.q ilike '%' || x || '%'))) as contains_name,
           (select exists (
              select 1
                from unnest(c.all_names) x,
                     lateral regexp_split_to_table(lower(x), '[^[:alnum:]]+') as w
               where length(w) >= 4 and w in (select nw.w from needle_words nw))) as shares_word
      from cand c
  )
  select s.id, s.name, s.supplier_code, s.account_name, s.account_number, s.bank_name,
         s.sim::real as similarity, coalesce(s.same_account, false) as same_account
    from scored s
   where coalesce(s.same_account, false)
      or s.exact_name
      or s.sim > 0.3
      or s.contains_name
      or s.shares_word
   order by coalesce(s.same_account, false) desc, s.exact_name desc, s.sim desc, s.name
   limit 12;
$$;

comment on function public.find_similar_suppliers(text, text, uuid) is
  'Likely duplicates of a supplier: same account number, or any name they have '
  'ever had (name + former_names) matching exactly, by trigram, by containment, '
  'or by a shared word of 4+ letters. Ordered strongest signal first.';

-- Default privileges hand new objects to anon as well, and both run with owner
-- rights over the walled suppliers table (0126), so anon is revoked explicitly.
revoke execute on function public.merge_suppliers(uuid, uuid) from public, anon;
revoke execute on function public.find_similar_suppliers(text, text, uuid) from public, anon;
grant  execute on function public.merge_suppliers(uuid, uuid) to authenticated;
grant  execute on function public.find_similar_suppliers(text, text, uuid) to authenticated;
