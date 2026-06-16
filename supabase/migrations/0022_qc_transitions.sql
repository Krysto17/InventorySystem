-- ─── Phase 9: QC pipeline transitions ───────────────────────────────────────
-- visits.state UPDATE RLS is processing/owner-only, so (as with the legacy
-- analysis trigger) receiving→in_qc and in_qc→pricing are driven by SECURITY
-- DEFINER code that does its own role/site checks.

-- Receiving signals "done weighing this batch" → advance in_receiving → in_qc.
create or replace function public.advance_visit_to_qc(p_visit_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_site uuid;
  v_state text;
  n int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then
    raise exception 'visit not found';
  end if;
  if not (public.is_owner()
          or (public.current_role() = 'receiving' and v_site = public.current_site())) then
    raise exception 'not authorized to advance this visit';
  end if;
  if v_state <> 'in_receiving' then
    raise exception 'visit is not in receiving';
  end if;
  select count(*) into n from public.visit_materials where visit_id = p_visit_id;
  if n = 0 then
    raise exception 'cannot advance to QC without material lines';
  end if;
  update public.visits set state = 'in_qc' where id = p_visit_id;
end;
$$;

grant execute on function public.advance_visit_to_qc(uuid) to authenticated;

-- XRF insert/update: audit + auto-advance in_qc → pricing once every line of the
-- batch has a submitted XRF result.
create or replace function public._xrf_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_visit uuid;
  v_state text;
  total int;
  submitted_count int;
begin
  select vm.visit_id into v_visit
    from public.visit_materials vm where vm.id = NEW.visit_material_id;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (
    v_visit,
    case when TG_OP = 'INSERT' then 'record_created' else 'record_edited' end,
    auth.uid(),
    jsonb_build_object('table', 'xrf_records', 'record_id', NEW.id, 'submitted', NEW.submitted)
  );

  select count(*) into total from public.visit_materials where visit_id = v_visit;
  select count(*) into submitted_count
    from public.visit_materials vm
    join public.xrf_records x on x.visit_material_id = vm.id
   where vm.visit_id = v_visit and x.submitted;

  select state into v_state from public.visits where id = v_visit;
  if v_state = 'in_qc' and total > 0 and submitted_count = total then
    update public.visits set state = 'pricing' where id = v_visit;
  end if;

  return NEW;
end;
$$;

create trigger t_xrf_records_after
  after insert or update on public.xrf_records
  for each row execute function public._xrf_records_after();
