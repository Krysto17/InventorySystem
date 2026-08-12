-- ─── Every batch passes through QC, analysis required or not ────────────────
-- A line marked "no analysis required" used to skip QC entirely: a batch of
-- only exempt lines went from receiving straight to pricing. But QC does more
-- than the XRF — it re-weighs the material, and a >2% difference against
-- receiving's weight is what raises a mismatch. Skipping QC skipped the weigh.
--
-- Exempt material now goes to QC like everything else; QC confirms it with a
-- weight and no XRF result. The manager's explicit skip (approve_visit_by_manager
-- with p_skip_qc) is untouched — that is a deliberate waiver, not a default.

create or replace function public.submit_visit_to_manager(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; n_total int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'receiving' and v_site = public.current_site())) then
    raise exception 'not authorized to submit this visit';
  end if;
  if v_state <> 'in_receiving' then raise exception 'visit is not in receiving'; end if;
  select count(*) into n_total from public.visit_materials where visit_id = p_visit_id;
  if n_total = 0 then raise exception 'cannot submit without material lines'; end if;
  -- Every batch is weighed by QC, whether or not any line needs an XRF.
  update public.visits set state = 'in_qc' where id = p_visit_id;
end; $$;

create or replace function public.approve_visit_by_manager(
  p_visit_id uuid,
  p_skip_qc boolean default false
)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to approve this visit';
  end if;
  if v_state <> 'awaiting_manager' then raise exception 'visit is not awaiting manager approval'; end if;

  if p_skip_qc then
    -- An explicit waiver by the manager: no analysis, no QC weigh, straight to
    -- pricing. Marking the lines exempt keeps the pricing-entry invariant true.
    update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
    update public.visits set state = 'pricing' where id = p_visit_id;
    return;
  end if;

  update public.visits set state = 'in_qc' where id = p_visit_id;
end; $$;

-- A batch leaves QC when QC has checked EVERY line, not only the ones needing
-- an XRF — otherwise a batch of exempt lines would sit in QC forever.
create or replace function public._xrf_records_after()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_visit uuid;
  v_state text;
  total_lines int;
  submitted_count int;
begin
  select visit_id into v_visit from public.visit_materials where id = NEW.visit_material_id;
  if v_visit is null then return NEW; end if;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (
    v_visit,
    case when TG_OP = 'INSERT' then 'record_created' else 'record_edited' end,
    auth.uid(),
    jsonb_build_object('table', 'xrf_records', 'record_id', NEW.id,
                       'submitted', NEW.submitted, 'mismatch', NEW.mismatch)
  );

  select count(*) into total_lines
    from public.visit_materials vm where vm.visit_id = v_visit;
  select count(*) into submitted_count
    from public.visit_materials vm
    join public.xrf_records x on x.visit_material_id = vm.id
   where vm.visit_id = v_visit and x.submitted;

  select state into v_state from public.visits where id = v_visit;
  if v_state = 'in_qc' and total_lines > 0 and submitted_count = total_lines then
    update public.visits set state = 'pricing' where id = v_visit;
  end if;

  return NEW;
end; $$;
