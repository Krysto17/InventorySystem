-- ─── Supply flow: site-manager approval after receiving (#7/#8/#11) ──────────
-- Receiving records lines → submits to the SITE manager (awaiting_manager) →
-- the manager approves → QC if any line needs analysis, else straight to pricing
-- (exempt materials skip QC, #8). One approval (the visit's own site manager).

-- 1. New state.
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'in_processing','in_receiving','awaiting_manager','in_qc','pricing',
  'awaiting_gate_exit','in_accounting','exited','awaiting_stock_intake','stocked'
));

-- 2. State machine: receiving → awaiting_manager → (in_qc | pricing).
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_submitted_xrf boolean;
  has_lines boolean;
  all_exempt boolean;
  has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;

  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'),
    ('in_receiving','awaiting_manager'),
    ('in_receiving','in_qc'),          -- owner override
    ('in_receiving','pricing'),        -- owner override
    ('awaiting_manager','in_qc'),
    ('awaiting_manager','pricing'),
    ('in_qc','pricing'),
    ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'),
    ('pricing','exited'),
    ('pricing','stocked'),
    ('awaiting_gate_exit','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','stocked'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state using errcode = '22000';
  end if;

  if NEW.state in ('awaiting_manager','in_qc') then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot advance without material lines'; end if;
  end if;

  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis)
      into all_exempt;
    if not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id)
      into has_authorization;
    if not has_authorization then
      raise exception 'cannot release without a gate exit authorization';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end; $$;

-- 3. Audit owner-override edge list mirrors the legal forward edges.
create or replace function public._visits_write_audit()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'visit_created', NEW.created_by,
      jsonb_build_object(
        'entry_path', NEW.entry_path, 'supplier_id', NEW.supplier_id,
        'declared_material_type_id', NEW.declared_material_type_id,
        'vehicle_plate', NEW.vehicle_plate, 'site_id', NEW.site_id));
    return NEW;
  end if;

  if NEW.state <> OLD.state then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.id, 'state_changed', auth.uid(),
            jsonb_build_object('from', OLD.state, 'to', NEW.state));

    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('in_processing','in_receiving'),
      ('in_receiving','awaiting_manager'),
      ('awaiting_manager','in_qc'),
      ('awaiting_manager','pricing'),
      ('in_qc','pricing'),
      ('pricing','in_accounting'),
      ('pricing','awaiting_gate_exit'),
      ('pricing','exited'),
      ('pricing','stocked'),
      ('awaiting_gate_exit','exited'),
      ('in_accounting','awaiting_stock_intake'),
      ('in_accounting','stocked'),
      ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;

  return NEW;
end; $$;

-- 4a. Receiving submits the batch to the site manager.
create or replace function public.submit_visit_to_manager(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; n int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
          or (public.current_role() = 'receiving' and v_site = public.current_site())) then
    raise exception 'not authorized to submit this visit';
  end if;
  if v_state <> 'in_receiving' then raise exception 'visit is not in receiving'; end if;
  select count(*) into n from public.visit_materials where visit_id = p_visit_id;
  if n = 0 then raise exception 'cannot submit without material lines'; end if;
  update public.visits set state = 'awaiting_manager' where id = p_visit_id;
end; $$;

-- 4b. The (site) manager approves → QC if any line needs analysis, else pricing.
create or replace function public.approve_visit_by_manager(p_visit_id uuid)
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
  select count(*) filter (where requires_analysis) into n_required
    from public.visit_materials where visit_id = p_visit_id;
  if n_required = 0 then
    update public.visits set state = 'pricing' where id = p_visit_id;   -- exempt → pricing (#8)
  else
    update public.visits set state = 'in_qc' where id = p_visit_id;
  end if;
end; $$;

-- Retire the old direct receiving→QC RPC so receiving can't skip the manager gate.
drop function if exists public.advance_visit_to_qc(uuid);
