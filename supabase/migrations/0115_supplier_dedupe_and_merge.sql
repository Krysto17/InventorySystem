-- ─── Stop duplicate suppliers, and merge the ones that slip through ─────────
-- Duplicates ("Madam Maria" vs "Maria Dung") happen because anyone can type a
-- new supplier and an honorific doesn't look like a match. Two defences:
--   1. find_similar_suppliers() — warn at creation on a near-identical NAME
--      (trigram) or an ACCOUNT NUMBER already on file (the strongest signal).
--   2. merge_suppliers() — a safe, atomic merge that reassigns every reference,
--      keeps the old name as history, and removes the duplicate. Hand-written
--      SQL for this is how records get lost.

-- 1. Near-duplicate lookup. Name similarity OR an exact account-number hit.
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
  select s.id, s.name, s.supplier_code,
         s.account_name, s.account_number, s.bank_name,
         coalesce(similarity(s.name, coalesce(p_name, '')), 0) as similarity,
         (p_account_number is not null and btrim(p_account_number) <> ''
          and s.account_number = btrim(p_account_number)) as same_account
    from public.suppliers s
   where (p_exclude is null or s.id <> p_exclude)
     and (
       -- same account number = almost certainly the same person
       (p_account_number is not null and btrim(p_account_number) <> ''
        and s.account_number = btrim(p_account_number))
       -- or a similar name (0.3 is the usual pg_trgm "looks alike" threshold)
       or (p_name is not null and btrim(p_name) <> ''
           and similarity(s.name, p_name) > 0.3)
       -- or one name contains the other ("Maria" vs "Madam Maria")
       or (p_name is not null and length(btrim(p_name)) >= 4
           and (s.name ilike '%' || btrim(p_name) || '%'
                or btrim(p_name) ilike '%' || s.name || '%'))
     )
   order by same_account desc, similarity desc
   limit 8;
$$;
grant execute on function public.find_similar_suppliers(text, text, uuid) to authenticated;

-- 2. Merge one supplier into another (owner / general manager only).
--    Every reference moves to the survivor; the duplicate's name is preserved in
--    former_names so old paperwork still traces; then the duplicate is removed.
create or replace function public.merge_suppliers(p_keep uuid, p_duplicate uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_keep_name text; v_dupe_name text; v_dupe_former text[];
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

  -- Move every reference (all 8 FKs to suppliers).
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
end; $$;

grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;
