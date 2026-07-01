-- ─── Owner price-approval gate (#1/#5) ───────────────────────────────────────
-- Manager's agreed price no longer jumps straight to accounting. Instead the
-- visit parks at 'awaiting_price_approval' (Pricing done, in the owner's
-- approval table). The owner's single Approve finalizes every line price AND
-- releases the visit to accounting (owner approve == finalize, #1).

-- 1. New state.
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'in_processing','in_receiving','awaiting_manager','in_qc','pricing',
  'awaiting_price_approval','awaiting_gate_exit','in_accounting','exited',
  'awaiting_stock_intake','stocked'
));

-- 2. State-machine validator: add the price-approval edges.
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
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),
    ('awaiting_manager','in_qc'),
    ('awaiting_manager','pricing'),
    ('in_qc','pricing'),
    ('pricing','awaiting_price_approval'),
    ('awaiting_price_approval','in_accounting'),
    ('awaiting_price_approval','pricing'),
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
    -- Coming back from the approval gate (owner send-back) needs no re-check.
    if OLD.state <> 'awaiting_price_approval'
       and not has_analysis and not has_submitted_xrf and not all_exempt then
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

-- 3. Audit: the new edges are legitimate, not owner overrides.
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
      ('pricing','awaiting_price_approval'),
      ('awaiting_price_approval','in_accounting'),
      ('awaiting_price_approval','pricing'),
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

-- 4. Agreed pricing now parks at the approval gate instead of accounting.
create or replace function public._pricing_after()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_state text; target_state text := null;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.priced_by,
            jsonb_build_object('table', 'pricing', 'record_id', NEW.id,
                               'fields', jsonb_build_object(
                                 'unit_price', NEW.unit_price,
                                 'agreement_status', NEW.agreement_status,
                                 'payment_terms', NEW.payment_terms)));
  else
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_edited', auth.uid(),
            jsonb_build_object('table', 'pricing', 'record_id', NEW.id,
              'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))));
  end if;

  if NEW.agreement_status = 'agreed'      then target_state := 'awaiting_price_approval'; end if;
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end; $$;

-- 5. Owner approves: finalize every line price + release to accounting.
create or replace function public.approve_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_state text;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state into v_state from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;
  update public.visit_materials set price_finalized = true where visit_id = p_visit_id;
  update public.visits set state = 'in_accounting' where id = p_visit_id;
end; $$;

-- 6. Owner sends pricing back to the manager.
create or replace function public.reject_pricing(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'only the owner can reject pricing'; end if;
  update public.visits set state = 'pricing'
    where id = p_visit_id and state = 'awaiting_price_approval';
end; $$;

grant execute on function public.approve_pricing(uuid) to authenticated;
grant execute on function public.reject_pricing(uuid) to authenticated;
