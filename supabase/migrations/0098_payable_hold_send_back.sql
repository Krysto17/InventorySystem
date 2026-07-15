-- ─── Unified hold / release / send-back for every payable ────────────────────
-- Owner, manager, or accountant may HOLD an approved payment (drops off the
-- accountant's to-pay queue), RELEASE it, or SEND it BACK to the manager for
-- correction. Applies to supplier settlements, advances, and expenses.
--   • settlement send-back  → void it, unlock prices, visit returns to Pricing
--   • advance / expense send-back → back to 'pending' with a correction note
-- Authorization is owner (any site), general manager/accountant (any site), or a
-- site manager/accountant (own site). All routed through SECURITY DEFINER RPCs;
-- a transaction-local GUC lets the RPCs make the status change past the
-- role-scoped transition guards.

-- Reusable predicate: may the caller review a payable on the given site?
create or replace function public._can_review_payable(p_site uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or public.is_general_manager()
      or public.is_general_accountant()
      or (public.current_role() in ('manager', 'accounting') and p_site = public.current_site());
$$;
grant execute on function public._can_review_payable(uuid) to authenticated;

-- ─── Settlements ─────────────────────────────────────────────────────────────
-- Re-add the in_accounting → pricing edge (send-back voids to the manager) to
-- the visit guard + audit; keep the in_accounting → awaiting_price_approval edge.
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean; has_analysis boolean; has_submitted_xrf boolean;
  has_lines boolean; all_exempt boolean; has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;
  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'), ('in_receiving','awaiting_manager'),
    ('in_receiving','in_qc'), ('in_receiving','pricing'), ('awaiting_manager','in_qc'),
    ('awaiting_manager','pricing'), ('in_qc','pricing'), ('pricing','awaiting_price_approval'),
    ('awaiting_price_approval','in_accounting'), ('awaiting_price_approval','pricing'),
    ('pricing','in_accounting'), ('pricing','awaiting_gate_exit'), ('pricing','exited'),
    ('pricing','stocked'), ('awaiting_gate_exit','exited'), ('in_accounting','awaiting_stock_intake'),
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
    -- No re-check when coming back from the approval gate or from accounting.
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
      ('in_processing','in_receiving'), ('in_receiving','awaiting_manager'), ('awaiting_manager','in_qc'),
      ('awaiting_manager','pricing'), ('in_qc','pricing'), ('pricing','awaiting_price_approval'),
      ('awaiting_price_approval','in_accounting'), ('awaiting_price_approval','pricing'),
      ('pricing','in_accounting'), ('pricing','awaiting_gate_exit'), ('pricing','exited'),
      ('pricing','stocked'), ('awaiting_gate_exit','exited'), ('in_accounting','awaiting_stock_intake'),
      ('in_accounting','awaiting_price_approval'), ('in_accounting','pricing'),
      ('in_accounting','stocked'), ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;
  return NEW;
end; $$;

-- Settlement transition: hold/release now allowed for any reviewer via the GUC.
create or replace function public._batch_settlements_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then NEW.updated_at := now(); return NEW; end if;

  if coalesce(current_setting('app.ledger_payment', true), '') = 'on'
     and OLD.status in ('approved', 'partially_paid') and NEW.status in ('partially_paid', 'paid') then
    if NEW.status = 'paid' then
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    end if;
  elsif coalesce(current_setting('app.payable_review', true), '') = 'on'
        and ((OLD.status = 'approved' and NEW.status = 'on_hold')
          or (OLD.status = 'on_hold' and NEW.status = 'approved')) then
    if NEW.status = 'on_hold' then
      NEW.held_by := coalesce(NEW.held_by, auth.uid()); NEW.held_at := coalesce(NEW.held_at, now());
    else
      NEW.held_by := null; NEW.held_at := null;
    end if;
  elsif OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'only the owner approves or rejects a batch settlement';
    end if;
    NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
    NEW.approved_at := coalesce(NEW.approved_at, now());
  elsif OLD.status = 'approved' and NEW.status = 'paid' then
    if auth.uid() is not null and public.current_role() <> 'accounting' then
      raise exception 'only the accountant can mark a settlement paid';
    end if;
    NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
    NEW.paid_at := coalesce(NEW.paid_at, now());
  else
    raise exception 'illegal batch settlement transition: % → %', OLD.status, NEW.status using errcode = '22000';
  end if;

  NEW.updated_at := now();
  return NEW;
end; $$;

create or replace function public.hold_settlement(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, status into v_site, v_status from public.batch_settlements where id = p_id;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to hold this payment'; end if;
  if v_status <> 'approved' then raise exception 'only an approved (unpaid) payment can be held'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.batch_settlements set status = 'on_hold' where id = p_id;
end; $$;

create or replace function public.release_settlement(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, status into v_site, v_status from public.batch_settlements where id = p_id;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to release this payment'; end if;
  if v_status <> 'on_hold' then raise exception 'only a held payment can be released'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.batch_settlements set status = 'approved' where id = p_id;
end; $$;

-- Send a settlement back to the manager: void it, unlock the prices, and return
-- the visit to Pricing. Only when nothing has been paid yet.
create or replace function public.send_settlement_back(p_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text; v_visit uuid;
begin
  select site_id, status, visit_id into v_site, v_status, v_visit from public.batch_settlements where id = p_id;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to send this back'; end if;
  if v_status not in ('approved', 'on_hold') then
    raise exception 'only an approved or held (unpaid) settlement can be sent back';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  if public.settlement_paid_total(p_id) > 0 then
    raise exception 'this settlement already has payments — it cannot be sent back';
  end if;

  delete from public.batch_settlements where id = p_id;
  perform set_config('app.allow_price_unlock', 'on', true);
  update public.visit_materials set price_finalized = false where visit_id = v_visit;
  update public.visits set state = 'pricing' where id = v_visit;
  insert into public.batch_comments (visit_id, site_id, body, author)
  values (v_visit, v_site, '↩︎ Payment sent back by ' || public.current_role() || ' for correction: ' || btrim(p_reason), auth.uid());
end; $$;

grant execute on function public.hold_settlement(uuid) to authenticated;
grant execute on function public.release_settlement(uuid) to authenticated;
grant execute on function public.send_settlement_back(uuid, text) to authenticated;

-- ─── Advances ────────────────────────────────────────────────────────────────
alter table public.advances drop constraint if exists advances_approval_status_check;
alter table public.advances add constraint advances_approval_status_check
  check (approval_status in ('pending', 'approved', 'on_hold', 'rejected', 'paid'));
alter table public.advances
  add column if not exists held_by uuid references public.profiles(id),
  add column if not exists held_at timestamptz,
  add column if not exists correction_note text;

-- Extend the strict advance guard with the review transitions (GUC-gated).
create or replace function public._advances_before_update()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.approval_status is distinct from OLD.approval_status then
    if coalesce(current_setting('app.payable_review', true), '') = 'on'
       and ((OLD.approval_status = 'approved' and NEW.approval_status in ('on_hold', 'pending'))
         or (OLD.approval_status = 'on_hold' and NEW.approval_status in ('approved', 'pending'))) then
      null; -- authorized + stamped by the RPC
    elsif OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
      if auth.uid() is not null and not public.is_owner() then
        raise exception 'only the owner approves or rejects an advance';
      end if;
      NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
      NEW.approved_at := coalesce(NEW.approved_at, now());
    elsif OLD.approval_status = 'approved' and NEW.approval_status = 'paid' then
      if auth.uid() is not null and public.current_role() <> 'accounting' then
        raise exception 'only the accountant can mark an advance paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal advance transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $$;

create or replace function public.hold_advance(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.advances where id = p_id;
  if v_site is null then raise exception 'advance not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to hold this advance'; end if;
  if v_status <> 'approved' then raise exception 'only an approved (unpaid) advance can be held'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.advances set approval_status = 'on_hold', held_by = auth.uid(), held_at = now() where id = p_id;
end; $$;

create or replace function public.release_advance(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.advances where id = p_id;
  if v_site is null then raise exception 'advance not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to release this advance'; end if;
  if v_status <> 'on_hold' then raise exception 'only a held advance can be released'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.advances set approval_status = 'approved', held_by = null, held_at = null where id = p_id;
end; $$;

create or replace function public.send_advance_back(p_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.advances where id = p_id;
  if v_site is null then raise exception 'advance not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to send this back'; end if;
  if v_status not in ('approved', 'on_hold') then raise exception 'only an approved or held advance can be sent back'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.advances
    set approval_status = 'pending', approved_by = null, approved_at = null,
        held_by = null, held_at = null, correction_note = btrim(p_reason)
    where id = p_id;
end; $$;

grant execute on function public.hold_advance(uuid) to authenticated;
grant execute on function public.release_advance(uuid) to authenticated;
grant execute on function public.send_advance_back(uuid, text) to authenticated;

-- ─── Expenses (consumables) ──────────────────────────────────────────────────
alter table public.consumables drop constraint if exists consumables_approval_status_check;
alter table public.consumables add constraint consumables_approval_status_check
  check (approval_status in ('pending', 'approved', 'on_hold', 'rejected', 'paid'));
alter table public.consumables
  add column if not exists held_by uuid references public.profiles(id),
  add column if not exists held_at timestamptz,
  add column if not exists correction_note text;

-- Extend the strict expense guard with the review transitions (GUC-gated).
create or replace function public._consumables_approval_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.approval_status is distinct from OLD.approval_status then
    if coalesce(current_setting('app.payable_review', true), '') = 'on'
       and ((OLD.approval_status = 'approved' and NEW.approval_status in ('on_hold', 'pending'))
         or (OLD.approval_status = 'on_hold' and NEW.approval_status in ('approved', 'pending'))) then
      null; -- authorized + stamped by the RPC
    elsif OLD.approval_status = 'pending' and NEW.approval_status in ('approved', 'rejected') then
      if auth.uid() is not null and not public.is_owner() then
        raise exception 'only the owner approves expenses';
      end if;
      NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
      NEW.approved_at := coalesce(NEW.approved_at, now());
    elsif OLD.approval_status = 'approved' and NEW.approval_status = 'paid' then
      if auth.uid() is not null and public.current_role() <> 'accounting' then
        raise exception 'only the accountant marks expenses paid';
      end if;
      NEW.paid_by := coalesce(NEW.paid_by, auth.uid());
      NEW.paid_at := coalesce(NEW.paid_at, now());
    else
      raise exception 'illegal expense status transition: % → %', OLD.approval_status, NEW.approval_status;
    end if;
  end if;
  return NEW;
end; $$;

create or replace function public.hold_expense(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.consumables where id = p_id;
  if v_site is null then raise exception 'expense not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to hold this expense'; end if;
  if v_status <> 'approved' then raise exception 'only an approved (unpaid) expense can be held'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.consumables set approval_status = 'on_hold', held_by = auth.uid(), held_at = now() where id = p_id;
end; $$;

create or replace function public.release_expense(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.consumables where id = p_id;
  if v_site is null then raise exception 'expense not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to release this expense'; end if;
  if v_status <> 'on_hold' then raise exception 'only a held expense can be released'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.consumables set approval_status = 'approved', held_by = null, held_at = null where id = p_id;
end; $$;

create or replace function public.send_expense_back(p_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, approval_status into v_site, v_status from public.consumables where id = p_id;
  if v_site is null then raise exception 'expense not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to send this back'; end if;
  if v_status not in ('approved', 'on_hold') then raise exception 'only an approved or held expense can be sent back'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  perform set_config('app.payable_review', 'on', true);
  update public.consumables
    set approval_status = 'pending', approved_by = null, approved_at = null,
        held_by = null, held_at = null, correction_note = btrim(p_reason)
    where id = p_id;
end; $$;

grant execute on function public.hold_expense(uuid) to authenticated;
grant execute on function public.release_expense(uuid) to authenticated;
grant execute on function public.send_expense_back(uuid, text) to authenticated;
