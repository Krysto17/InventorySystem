-- ─── General manager runs the receiving module ──────────────────────────────
-- The New-Site (general) manager now creates receiving intake visits and records
-- receiving lines. Migration 0077 already granted the GM cross-site write on
-- visit_materials; this adds the two pieces receiving still needs: inserting the
-- parent visit, and submitting a received batch to analysis/pricing.

-- 1. The general manager may create visits (like a cross-site intake operator).
create policy "visits: general manager inserts any"
  on public.visits for insert to authenticated
  with check (public.is_general_manager());

-- 2. submit_visit_to_manager (receiving → in_qc / pricing) also accepts the GM.
create or replace function public.submit_visit_to_manager(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; n_total int; n_required int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'receiving' and v_site = public.current_site())) then
    raise exception 'not authorized to submit this visit';
  end if;
  if v_state <> 'in_receiving' then raise exception 'visit is not in receiving'; end if;
  select count(*), count(*) filter (where requires_analysis)
    into n_total, n_required
    from public.visit_materials where visit_id = p_visit_id;
  if n_total = 0 then raise exception 'cannot submit without material lines'; end if;
  if n_required = 0 then
    update public.visits set state = 'pricing' where id = p_visit_id;   -- exempt → pricing
  else
    update public.visits set state = 'in_qc' where id = p_visit_id;     -- needs analysis
  end if;
end; $$;
