-- ─── Pricing authority: owner finalizes; manager cannot then modify ─────────
-- Manager assigns draft per-line prices; the owner (director) has final pricing
-- authority. Once the owner finalizes a line's price, the manager can no longer
-- change it. Only the owner may finalize (or unfinalize).

alter table public.visit_materials
  add column price_finalized boolean not null default false,
  add column finalized_by    uuid references public.profiles(id),
  add column finalized_at     timestamptz;

create or replace function public._visit_materials_price_lock()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Only the owner may flip the finalize flag.
  if NEW.price_finalized is distinct from OLD.price_finalized and not public.is_owner() then
    raise exception 'only the owner can finalize or unfinalize a price';
  end if;

  -- Once finalized, only the owner may change the unit price.
  if OLD.price_finalized
     and NEW.unit_price is distinct from OLD.unit_price
     and not public.is_owner() then
    raise exception 'price is finalized by the owner and can no longer be modified';
  end if;

  -- Stamp who finalized it.
  if NEW.price_finalized and not OLD.price_finalized then
    NEW.finalized_by := coalesce(NEW.finalized_by, auth.uid());
    NEW.finalized_at := coalesce(NEW.finalized_at, now());
  end if;

  return NEW;
end;
$$;

create trigger t_visit_materials_price_lock
  before update on public.visit_materials
  for each row execute function public._visit_materials_price_lock();

-- Owner needs column-level UPDATE on the finalize fields (column grants apply to
-- the authenticated role; the trigger restricts the actual change to the owner).
grant update (price_finalized, finalized_by, finalized_at) on public.visit_materials to authenticated;
