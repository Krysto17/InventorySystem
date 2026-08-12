-- ─── The site manager can run the store check themselves ────────────────────
-- Not every store has its own keeper — at a site without one the manager walks
-- the store. They get the same job on their own site: tick what is there,
-- dispute what is missing or short.

drop policy if exists "stock_confirmations: keeper records own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper records own site"
  on public.stock_confirmations for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role()::text in ('stock_keeper', 'manager') and site_id = public.current_site())
  );

drop policy if exists "stock_confirmations: keeper updates own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper updates own site"
  on public.stock_confirmations for update to authenticated
  using (
    public.is_owner()
    or (public.current_role()::text in ('stock_keeper', 'manager') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role()::text in ('stock_keeper', 'manager') and site_id = public.current_site())
  );

drop policy if exists "stock_confirmations: keeper clears own site" on public.stock_confirmations;
create policy "stock_confirmations: keeper clears own site"
  on public.stock_confirmations for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role()::text in ('stock_keeper', 'manager') and site_id = public.current_site())
  );

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
          or (public.current_role()::text in ('stock_keeper', 'manager')
              and v_site = public.current_site())) then
    raise exception 'only the store keeper or the site manager can check their own store';
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
