-- ─── Blueprint reconciliation: cost-price batch identity ─────────────────────
-- A saved cost-price computation now carries a human-readable batch code, the
-- material type it was computed for, and a datestamp embedded in the code —
-- mirroring the inventory batch-number scheme, e.g. CPR-DON-20260616-001.

create sequence if not exists public.cost_price_batch_seq start 1;

alter table public.cost_price_runs
  add column material_type_id uuid references public.material_types(id),
  add column batch_code       text unique;

create or replace function public._cost_price_runs_set_code()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  site_code text;
begin
  if NEW.batch_code is null then
    select upper(left(regexp_replace(s.name, '[^A-Za-z]', '', 'g'), 3))
      into site_code
      from public.sites s
     where s.id = NEW.site_id;

    NEW.batch_code := 'CPR-' || coalesce(site_code, 'MJZ') || '-'
      || to_char(coalesce(NEW.created_at, now()), 'YYYYMMDD') || '-'
      || lpad(nextval('public.cost_price_batch_seq')::text, 3, '0');
  end if;
  return NEW;
end;
$$;

create trigger t_cost_price_runs_set_code
  before insert on public.cost_price_runs
  for each row execute function public._cost_price_runs_set_code();
