-- ─── One supplier, one name (#3) ─────────────────────────────────────────────
-- Suppliers are already global (usable at any site). Merge any duplicate names
-- (case-insensitive) into the earliest record — repointing every foreign key —
-- then enforce a unique name so the same supplier can't be entered twice under
-- slightly different spellings.

do $$
declare grp record; dup record; fk record;
begin
  for grp in
    select lower(name) as lname, (array_agg(id order by created_at, id))[1] as keep_id
    from public.suppliers
    group by lower(name)
    having count(*) > 1
  loop
    for dup in
      select id from public.suppliers
      where lower(name) = grp.lname and id <> grp.keep_id
    loop
      -- Repoint every FK column that references suppliers onto the keeper.
      for fk in
        select c.conrelid::regclass::text as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = 'public.suppliers'::regclass
      loop
        execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
          using grp.keep_id, dup.id;
      end loop;
      delete from public.suppliers where id = dup.id;
    end loop;
  end loop;
end $$;

-- Enforce unique supplier names (case-insensitive) from here on.
create unique index if not exists suppliers_name_lower_unique
  on public.suppliers (lower(name));
