-- ─── Only material the company has paid for is counted into the store ───────
-- A lot is normally created the moment its batch is marked paid, so everything
-- in stock is paid for. But a settlement can be reversed after the fact, and
-- then the lot is sitting there against material we no longer own. Counting
-- that into the store would confirm stock the company has not bought.
--
-- A lot with no settlement behind it (a manual or mixed-batch lot) has no paid
-- state to check, so it stays countable.

create or replace function public.record_stock_check(
  p_lot_id uuid,
  p_status text,
  p_counted_weight numeric default null,
  p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_settlement text; v_has_source boolean;
begin
  select sl.site_id,
         vm.id is not null,
         bs.status
    into v_site, v_has_source, v_settlement
    from public.stock_lots sl
    left join public.visit_materials vm on vm.id = sl.ref_visit_material_id
    left join public.batch_settlements bs on bs.visit_id = vm.visit_id
   where sl.id = p_lot_id and sl.status = 'available';

  if v_site is null then raise exception 'that lot is not in stock'; end if;
  if not (public.is_owner()
          or (public.current_role()::text in ('stock_keeper', 'manager')
              and v_site = public.current_site())) then
    raise exception 'only the store keeper or the site manager can check their own store';
  end if;
  if p_status not in ('confirmed', 'disputed') then
    raise exception 'a lot is either confirmed or disputed';
  end if;
  if v_has_source and coalesce(v_settlement, 'unpaid') <> 'paid' then
    raise exception 'this material has not been paid for yet';
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
