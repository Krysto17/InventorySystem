-- ─── Confirming the stock is actually in the store ──────────────────────────
-- One standing check per lot: the keeper ticks it as present, or disputes it
-- with a note saying what is wrong — missing, or a different weight from what
-- the books say. Re-counting updates the same row, so a lot carries its latest
-- state rather than a pile of history.

create table if not exists public.stock_confirmations (
  id                uuid primary key default gen_random_uuid(),
  stock_lot_id      uuid not null unique references public.stock_lots(id) on delete cascade,
  site_id           uuid not null references public.sites(id),
  status            text not null check (status in ('confirmed', 'disputed')),
  counted_weight_kg numeric(12,3) check (counted_weight_kg is null or counted_weight_kg >= 0),
  dispute_note      text,
  checked_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A dispute has to say what is wrong; a confirmation needs no note.
  constraint stock_confirmations_dispute_needs_note
    check (status <> 'disputed' or coalesce(btrim(dispute_note), '') <> '')
);

create index if not exists stock_confirmations_site_status_idx
  on public.stock_confirmations (site_id, status);

drop trigger if exists t_stock_confirmations_touch on public.stock_confirmations;
create trigger t_stock_confirmations_touch
  before update on public.stock_confirmations
  for each row execute function public._touch_updated_at();

alter table public.stock_confirmations enable row level security;

-- The keeper works their own store. Everyone who answers for stock — manager
-- on site, inventory across sites, the owner — can read what was found.
drop policy if exists "stock_confirmations: read" on public.stock_confirmations;
create policy "stock_confirmations: read"
  on public.stock_confirmations for select to authenticated
  using (
    public.is_owner()
    or public.has_cross_site_read()
    or public.current_role()::text = 'inventory'
    or site_id = public.current_site()
  );

drop policy if exists "stock_confirmations: keeper records own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper records own site"
  on public.stock_confirmations for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role()::text = 'stock_keeper' and site_id = public.current_site())
  );

drop policy if exists "stock_confirmations: keeper updates own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper updates own site"
  on public.stock_confirmations for update to authenticated
  using (
    public.is_owner()
    or (public.current_role()::text = 'stock_keeper' and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role()::text = 'stock_keeper' and site_id = public.current_site())
  );

-- Correcting a miscount is the keeper's own job; a settled dispute is cleared
-- by the owner.
drop policy if exists "stock_confirmations: keeper clears own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper clears own site"
  on public.stock_confirmations for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role()::text = 'stock_keeper' and site_id = public.current_site())
  );

grant select, insert, update, delete on public.stock_confirmations to authenticated;

-- The keeper records a count in one call: the site is taken from the lot, so a
-- keeper cannot file against another store's stock, and a dispute without a
-- reason is refused by the table.
create or replace function public.record_stock_check(
  p_lot_id uuid,
  p_status text,
  p_counted_weight numeric default null,
  p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  select site_id into v_site from public.stock_lots where id = p_lot_id and status = 'available';
  if v_site is null then raise exception 'that lot is not in stock'; end if;
  if not (public.is_owner()
          or (public.current_role()::text = 'stock_keeper' and v_site = public.current_site())) then
    raise exception 'only the store keeper can check their own store';
  end if;
  if p_status not in ('confirmed', 'disputed') then
    raise exception 'a lot is either confirmed or disputed';
  end if;

  insert into public.stock_confirmations
    (stock_lot_id, site_id, status, counted_weight_kg, dispute_note, checked_by)
  values
    (p_lot_id, v_site, p_status, p_counted_weight, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (stock_lot_id) do update
    set status            = excluded.status,
        counted_weight_kg = excluded.counted_weight_kg,
        dispute_note      = excluded.dispute_note,
        checked_by        = excluded.checked_by,
        updated_at        = now();
end; $$;

grant execute on function public.record_stock_check(uuid, text, numeric, text) to authenticated;
