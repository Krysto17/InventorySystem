-- ─── Remove manager approval before analysis (#3/#6) ─────────────────────────
-- Receiving now submits straight to analysis (in_qc), or to pricing when no
-- line needs analysis. The separate awaiting_manager approval step is dropped.
-- The manager may still bypass analysis from in_qc → pricing (manager can price
-- with or without XRF). awaiting_manager stays a valid state value (orphaned)
-- but is no longer produced; existing in-flight rows are migrated forward.

-- 1. Receiving submits directly to analysis / pricing (no awaiting_manager).
create or replace function public.submit_visit_to_manager(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; n_total int; n_required int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
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

-- 2. Manager bypasses analysis from in_qc → pricing (price without XRF).
create or replace function public.manager_skip_to_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to skip analysis for this visit';
  end if;
  if v_state <> 'in_qc' then raise exception 'visit is not in analysis'; end if;
  -- Waive analysis on the remaining lines so the pricing-entry invariant holds.
  update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
  update public.visits set state = 'pricing' where id = p_visit_id;
end; $$;

grant execute on function public.manager_skip_to_pricing(uuid) to authenticated;

-- 3. The manager-approval RPC is retired (no awaiting_manager step anymore).
drop function if exists public.approve_visit_by_manager(uuid, boolean);

-- 4. Migrate any in-flight awaiting_manager visits forward.
update public.visits v set state = case
    when not exists (
      select 1 from public.visit_materials m where m.visit_id = v.id and m.requires_analysis
    ) then 'pricing'
    else 'in_qc'
  end
  where v.state = 'awaiting_manager';
