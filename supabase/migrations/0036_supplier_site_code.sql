-- ─── Blueprint reconciliation: site-prefixed supplier codes ──────────────────
-- Supplier IDs become SUP-<SITE>-#### (e.g. SUP-DON-0001), where <SITE> is a
-- 3-letter code derived from the registering user's site (Dong→DON,
-- New-Site→NEW, Old-Site→OLD). Suppliers remain global (no site_id column);
-- the prefix just records where a supplier was first entered. Owner / admin
-- inserts with no current site fall back to the company prefix MJZ.
-- The global sequence still guarantees uniqueness.

create or replace function public._suppliers_set_code()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  site_code text;
begin
  if NEW.supplier_code is null then
    select upper(left(regexp_replace(s.name, '[^A-Za-z]', '', 'g'), 3))
      into site_code
      from public.sites s
     where s.id = public.current_site();

    NEW.supplier_code := 'SUP-' || coalesce(site_code, 'MJZ') || '-'
      || lpad(nextval('public.supplier_code_seq')::text, 4, '0');
  end if;
  return NEW;
end;
$$;
