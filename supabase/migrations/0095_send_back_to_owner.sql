-- ─── Accountant sends a batch back to the OWNER, not straight to the manager ──
-- Revised review path: accounting → owner → manager. Instead of bouncing an
-- in-accounting batch directly to 'pricing', the accountant returns it to the
-- owner's approval queue ('awaiting_price_approval'). There the owner already
-- has "Approve & finalize" (approve_pricing) and "Send back" (reject_pricing →
-- pricing), so the owner decides whether it goes to the manager to re-price.
--
-- Supersedes 0093/0094's accountant_send_back_to_pricing. The approved
-- settlement is still voided and the line prices unlocked, which restores the
-- normal 'awaiting_price_approval' invariant (priced but not yet finalized).

-- 1. State guard: the accountant edge is now in_accounting → awaiting_price_approval.
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
    ('in_accounting','awaiting_price_approval'),
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
    -- Coming back from the approval gate needs no re-check.
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

-- 2. Audit: in_accounting → awaiting_price_approval is a legitimate edge.
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
      ('in_accounting','awaiting_price_approval'),
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

-- 3. Replace the send-back RPC: return the batch to the owner's approval queue.
drop function if exists public.accountant_send_back_to_pricing(uuid, text);

create or replace function public.accountant_send_back_to_owner(
  p_visit_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_state text; v_site uuid; v_settle text;
begin
  if not (public.current_role() = 'accounting' or public.is_owner()) then
    raise exception 'only accounting may send a batch back for review';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason for the review is required';
  end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'in_accounting' then
    raise exception 'only a batch sitting in accounting can be sent back';
  end if;
  if not (public.is_owner() or public.is_general_accountant() or v_site = public.current_site()) then
    raise exception 'no access to this site';
  end if;

  select status into v_settle from public.batch_settlements
    where visit_id = p_visit_id order by created_at desc limit 1;
  if v_settle = 'paid' then
    raise exception 'this batch is already paid — record a price correction instead';
  end if;

  -- Void the approved settlement + unlock line prices, restoring the normal
  -- 'awaiting_price_approval' state (priced, not yet finalized). The owner then
  -- re-approves or sends it on to the manager.
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  perform set_config('app.allow_price_unlock', 'on', true); -- transaction-local
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  update public.visits set state = 'awaiting_price_approval' where id = p_visit_id;

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site,
          '↩︎ Returned by accounting for the owner to review: ' || btrim(p_reason),
          auth.uid());
end; $$;

grant execute on function public.accountant_send_back_to_owner(uuid, text) to authenticated;
