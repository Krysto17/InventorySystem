-- ─── Manager may bypass XRF analysis straight to pricing (#3) ────────────────
-- At the approval step the manager chooses: send the batch to QC, or skip
-- analysis and go straight to pricing. Skipping marks the lines as not requiring
-- analysis (the existing exempt → pricing path), which also satisfies the
-- pricing-entry invariant. Backward compatible: p_skip_qc defaults false, so the
-- old single-arg call still routes to QC when lines need analysis.

drop function if exists public.approve_visit_by_manager(uuid);

create or replace function public.approve_visit_by_manager(
  p_visit_id uuid,
  p_skip_qc boolean default false
)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; n_required int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to approve this visit';
  end if;
  if v_state <> 'awaiting_manager' then raise exception 'visit is not awaiting manager approval'; end if;

  if p_skip_qc then
    -- Manager waives analysis for this batch → treat every line as exempt so the
    -- pricing-entry invariant (all_exempt) is satisfied, then go to pricing.
    update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
    update public.visits set state = 'pricing' where id = p_visit_id;
    return;
  end if;

  select count(*) filter (where requires_analysis) into n_required
    from public.visit_materials where visit_id = p_visit_id;
  if n_required = 0 then
    update public.visits set state = 'pricing' where id = p_visit_id;   -- exempt → pricing (#8)
  else
    update public.visits set state = 'in_qc' where id = p_visit_id;
  end if;
end; $$;

grant execute on function public.approve_visit_by_manager(uuid, boolean) to authenticated;
