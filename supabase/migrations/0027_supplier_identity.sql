-- ─── Phase 10 (E): Supplier identity ─────────────────────────────────────────
-- Every supplier gets a sequential business code (SUP-MJZ-0001) and a recorded
-- name history: renaming a supplier appends the old name to former_names, so
-- the UI can render "Ahmed Musa (Formerly Musa Ahmed)".

create sequence if not exists public.supplier_code_seq start 1;

alter table public.suppliers
  add column supplier_code text unique,
  add column former_names  text[] not null default '{}';

create or replace function public._suppliers_set_code()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.supplier_code is null then
    NEW.supplier_code := 'SUP-MJZ-' || lpad(nextval('public.supplier_code_seq')::text, 4, '0');
  end if;
  return NEW;
end;
$$;

create trigger t_suppliers_set_code
  before insert on public.suppliers
  for each row execute function public._suppliers_set_code();

create or replace function public._suppliers_track_rename()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.name is distinct from OLD.name then
    NEW.former_names := array_append(OLD.former_names, OLD.name);
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger t_suppliers_track_rename
  before update on public.suppliers
  for each row execute function public._suppliers_track_rename();

-- Backfill codes for existing suppliers in creation order.
do $$
declare
  r record;
begin
  for r in select id from public.suppliers where supplier_code is null order by created_at, id loop
    update public.suppliers
       set supplier_code = 'SUP-MJZ-' || lpad(nextval('public.supplier_code_seq')::text, 4, '0')
     where id = r.id;
  end loop;
end;
$$;
