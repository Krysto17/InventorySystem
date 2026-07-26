-- ─── Owner marks a price AGREED so the manager can act on it ────────────────
-- The owner prices a line on the analyses screen and may revise it several
-- times. Nothing told the manager when a price was final enough to forward for
-- payment. "Price agreed" is that explicit signal.
--
-- It deliberately does NOT lock the price (owner-confirmed): the owner can still
-- revise afterwards — the flag simply records that it was agreed, and by whom.
-- Distinct from price_finalized, which is the batch-level owner approval gate.

alter table public.visit_materials
  add column if not exists price_agreed    boolean not null default false,
  add column if not exists price_agreed_at timestamptz,
  add column if not exists price_agreed_by uuid references public.profiles(id);

-- visit_materials is granted UPDATE column-by-column (not table-wide), so a new
-- column is unwritable until it is granted explicitly.
grant update (price_agreed, price_agreed_at, price_agreed_by)
  on public.visit_materials to authenticated;

-- Only the owner may flip the agreed flag; stamp who/when, and clear the stamp
-- when it is withdrawn.
create or replace function public._visit_materials_price_agreed()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.price_agreed is distinct from OLD.price_agreed then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner can agree a price';
    end if;
    if NEW.price_agreed then
      NEW.price_agreed_by := coalesce(NEW.price_agreed_by, auth.uid());
      NEW.price_agreed_at := coalesce(NEW.price_agreed_at, now());
    else
      NEW.price_agreed_by := null;
      NEW.price_agreed_at := null;
    end if;
  end if;
  return NEW;
end; $$;

drop trigger if exists t_visit_materials_price_agreed on public.visit_materials;
create trigger t_visit_materials_price_agreed
  before update on public.visit_materials
  for each row execute function public._visit_materials_price_agreed();
