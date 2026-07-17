-- ─── Dressing-only close: carry to account OR paid in cash ───────────────────
-- Processing (or manager/owner) closes a dressing-only visit either by carrying
-- the light bill to the customer's account (a receivable) OR by confirming the
-- customer paid the light bill in cash on the spot (settled, not carried).

drop function if exists public.close_dressing_only(uuid);

create or replace function public.close_dressing_only(p_visit_id uuid, p_carry boolean default true)
  returns void language plpgsql security definer set search_path = public as $$
declare v_state text; v_site uuid; v_role text; v_has_bill boolean;
begin
  v_role := public.current_role();
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or (v_role in ('processing', 'manager') and v_site = public.current_site())) then
    raise exception 'not allowed to close this visit';
  end if;
  if v_state not in ('in_receiving', 'pricing') then
    raise exception 'a dressing-only close applies after processing, before supply (state: %)', v_state;
  end if;
  if exists (select 1 from public.batch_settlements where visit_id = p_visit_id) then
    raise exception 'this visit already has a settlement';
  end if;
  select exists (select 1 from public.utility_charges where visit_id = p_visit_id and kind = 'light_bill')
    into v_has_bill;
  if not v_has_bill then raise exception 'record the light bill before closing as dressing-only'; end if;

  -- Carry the light bill to the customer's account, or (cash) leave it settled.
  update public.utility_charges set carried = coalesce(p_carry, true)
    where visit_id = p_visit_id and kind = 'light_bill';
  update public.visits set dressing_only = true, state = 'exited' where id = p_visit_id;
end; $$;

grant execute on function public.close_dressing_only(uuid, boolean) to authenticated;
