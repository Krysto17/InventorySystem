-- ─── Cross-site light bills + dressing-only visits ──────────────────────────
-- A customer may process ("dress") material at one site and supply it at
-- another, or dress it purely for the light bill and take it away. In both cases
-- the light bill is a receivable the customer owes the company — the same
-- direction as an advance. So an unpaid light bill can be CARRIED to the
-- customer's account, where it joins supplier_outstanding_debt and is recovered
-- from their next supply (any site) or paid in cash — exactly like an advance.

alter table public.utility_charges add column if not exists carried boolean not null default false;
alter table public.visits add column if not exists dressing_only boolean not null default false;

-- 1. Outstanding balance now includes carried light bills.
create or replace function public.supplier_outstanding_debt(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_naira) from public.advances
                   where supplier_id = _supplier_id and approval_status = 'paid'), 0)
       + coalesce((select sum(uc.amount) from public.utility_charges uc
                   join public.visits v on v.id = uc.visit_id
                   where v.supplier_id = _supplier_id and uc.kind = 'light_bill' and uc.carried), 0)
       - coalesce((select sum(amount) from public.advance_deductions
                   where supplier_id = _supplier_id), 0);
$$;

-- Total carried light bills for a supplier (for a clear breakdown in the UI).
create or replace function public.supplier_carried_light_bills(_supplier_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(uc.amount) from public.utility_charges uc
                   join public.visits v on v.id = uc.visit_id
                   where v.supplier_id = _supplier_id and uc.kind = 'light_bill' and uc.carried), 0);
$$;
grant execute on function public.supplier_carried_light_bills(uuid) to authenticated;

-- 2. A carried light bill is never netted inside a visit settlement.
create or replace function public.settlement_totals(p_visit_id uuid)
  returns table (materials numeric, processing_fee numeric, other_deductions numeric,
                 advances numeric, net numeric, remaining_debt numeric)
  language sql stable security definer set search_path = public as $$
  with m as (
    select coalesce(sum(purchase_amount), 0) as materials
    from public.visit_materials where visit_id = p_visit_id and settlement_status = 'settled'
  ), c as (
    select coalesce(sum(amount) filter (where kind = 'light_bill' and not carried), 0) as light,
           coalesce(sum(amount) filter (where kind = 'other'), 0) as other
    from public.utility_charges where visit_id = p_visit_id
  ), a as (
    select coalesce(sum(amount), 0) as adv
    from public.advance_deductions where ref_visit_id = p_visit_id
  ), v as (
    select supplier_id from public.visits where id = p_visit_id
  )
  select m.materials, c.light, c.other, a.adv,
         m.materials - c.light - c.other - a.adv,
         public.supplier_outstanding_debt(v.supplier_id)
  from m, c, a, v;
$$;

-- 3. State guard: allow in_receiving → exited (the dressing-only close).
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
    ('in_accounting','stocked'), ('awaiting_stock_intake','stocked')
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
    if OLD.state not in ('awaiting_price_approval','in_accounting')
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
      ('in_accounting','pricing'), ('in_accounting','stocked'), ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;
  return NEW;
end; $$;

-- 4. Close a processing visit as "dressing only" — no supply. Carries the light
--    bill to the customer's account and exits the visit. Processing / manager
--    (own site) or owner.
create or replace function public.close_dressing_only(p_visit_id uuid)
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

  -- Carry the light bill(s) to the customer's account, then exit the visit.
  update public.utility_charges set carried = true where visit_id = p_visit_id and kind = 'light_bill';
  update public.visits set dressing_only = true, state = 'exited' where id = p_visit_id;
end; $$;

grant execute on function public.close_dressing_only(uuid) to authenticated;
