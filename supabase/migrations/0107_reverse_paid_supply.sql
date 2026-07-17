-- ─── Accountant reverses a paid supply (supplier refund) ────────────────────
-- A supplier sometimes refunds a paid supply to take the material back or
-- re-settle. Once the accountant confirms the refund, the paid supply is
-- reversed: the intake is rolled out of stock, the payment + settlement are
-- voided, and the visit returns to Pricing to be re-settled. Only allowed while
-- the material is still fully in stock (not sold, mixed, or gate-passed).

-- 1. Guard: allow the stocked → pricing reopen (accountant reversal).
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean; has_analysis boolean; has_submitted_xrf boolean;
  has_lines boolean; all_exempt boolean; has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;
  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'), ('in_receiving','awaiting_manager'),
    ('in_receiving','in_qc'), ('in_receiving','pricing'), ('in_receiving','exited'),
    ('awaiting_manager','in_qc'), ('awaiting_manager','pricing'), ('in_qc','pricing'),
    ('pricing','awaiting_price_approval'), ('awaiting_price_approval','in_accounting'),
    ('awaiting_price_approval','pricing'), ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'), ('pricing','exited'), ('pricing','stocked'),
    ('awaiting_gate_exit','exited'), ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','awaiting_price_approval'), ('in_accounting','pricing'),
    ('in_accounting','stocked'), ('awaiting_stock_intake','stocked'),
    ('stocked','pricing')
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
    select exists (select 1 from public.visit_materials vm join public.xrf_records x on x.visit_material_id = vm.id
                   where vm.visit_id = NEW.id and x.submitted) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis) into all_exempt;
    -- No re-check when reopening from the approval gate, accounting, or stock.
    if OLD.state not in ('awaiting_price_approval','in_accounting','stocked')
       and not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;
  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id) into has_authorization;
    if not has_authorization then raise exception 'cannot release without a gate exit authorization'; end if;
  end if;
  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;
  return NEW;
end; $$;

create or replace function public._visits_write_audit()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.id, 'visit_created', NEW.created_by,
      jsonb_build_object('entry_path', NEW.entry_path, 'supplier_id', NEW.supplier_id,
        'declared_material_type_id', NEW.declared_material_type_id,
        'vehicle_plate', NEW.vehicle_plate, 'site_id', NEW.site_id));
    return NEW;
  end if;
  if NEW.state <> OLD.state then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.id, 'state_changed', auth.uid(), jsonb_build_object('from', OLD.state, 'to', NEW.state));
    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('in_processing','in_receiving'), ('in_receiving','awaiting_manager'), ('in_receiving','exited'),
      ('awaiting_manager','in_qc'), ('awaiting_manager','pricing'), ('in_qc','pricing'),
      ('pricing','awaiting_price_approval'), ('awaiting_price_approval','in_accounting'),
      ('awaiting_price_approval','pricing'), ('pricing','in_accounting'), ('pricing','awaiting_gate_exit'),
      ('pricing','exited'), ('pricing','stocked'), ('awaiting_gate_exit','exited'),
      ('in_accounting','awaiting_stock_intake'), ('in_accounting','awaiting_price_approval'),
      ('in_accounting','pricing'), ('in_accounting','stocked'), ('awaiting_stock_intake','stocked'),
      ('stocked','pricing')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;
  return NEW;
end; $$;

-- 2. The reversal RPC.
create or replace function public.reverse_paid_supply(p_visit_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_settle uuid; v_status text; v_site uuid;
begin
  if not (public.current_role() = 'accounting' or public.is_owner()) then
    raise exception 'only accounting may reverse a paid supply';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason (refund confirmation) is required'; end if;

  select id, status, site_id into v_settle, v_status, v_site
    from public.batch_settlements where visit_id = p_visit_id;
  if v_settle is null then raise exception 'no settlement to reverse'; end if;
  if v_status <> 'paid' then raise exception 'only a paid supply can be reversed'; end if;
  if not (public.is_owner() or public.is_general_accountant() or v_site = public.current_site()) then
    raise exception 'no access to this site';
  end if;

  -- The intake lots must still be fully in stock and unused.
  if exists (
    select 1 from public.stock_lots sl
    join public.visit_materials vm on vm.id = sl.ref_visit_material_id
    where vm.visit_id = p_visit_id and (
      sl.status <> 'available'
      or exists (select 1 from public.cost_price_run_lots x where x.stock_lot_id = sl.id)
      or exists (select 1 from public.lot_sale_items x where x.stock_lot_id = sl.id)
      or exists (select 1 from public.gate_passes x where x.stock_lot_id = sl.id)
    )
  ) then
    raise exception 'cannot reverse — some of this material has already left stock (sold, mixed, or gate-passed)';
  end if;

  -- Roll the intake back out of stock.
  delete from public.stock_movements
    where ref_visit_id = p_visit_id and reason = 'purchase_intake' and direction = 'in';
  delete from public.stock_lots
    where ref_visit_material_id in (select id from public.visit_materials where visit_id = p_visit_id);

  -- Void the payment + settlement.
  delete from public.settlement_payments where settlement_id = v_settle;
  delete from public.batch_settlements where id = v_settle;

  -- Reopen for re-settlement at pricing.
  perform set_config('app.allow_price_unlock', 'on', true);
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  update public.pricing set agreement_status = 'pending' where visit_id = p_visit_id;
  update public.visits set state = 'pricing', dressing_only = false, closed_at = null where id = p_visit_id;

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site, '↩︎ Paid supply reversed (supplier refund confirmed): ' || btrim(p_reason), auth.uid());
end; $$;

grant execute on function public.reverse_paid_supply(uuid, text) to authenticated;
