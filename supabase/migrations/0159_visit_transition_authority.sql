-- ─── 0159: a visit moves only by the workflow — and the role — that owns the move ─
-- _visits_validate_transition checked WHICH from→to pairs exist, never WHO made
-- the move, and let the owner skip even that ("owner_override"). Visits' state
-- column is updatable by authenticated users, and RLS lets the gate, processing,
-- accounting and the owner update visits. Audit 3F (F-05) reproduced:
--   gate        in_accounting → stocked   (unpaid batch closed as stock)
--   processing  pricing → stocked
--   accounting  partly-paid in_accounting → pricing, around 0156's send-back guard
--
-- Business rulings 3F-T4:
--   * a transition is valid only when the pair exists, the actor's role owns it,
--     the actor has site authority, and its prerequisites hold;
--   * no blanket bypass — not the owner (owner_override has never been used in
--     production), not the service role, not SECURITY DEFINER code as such;
--   * GM = cross-site manager authority, nothing more;
--   * inventory owns no transition (it may only take part as a cash payer);
--   * seven dead legacy pairs are retired.
--
-- Mechanism. Every state change the application makes, except one, happens inside
-- trusted database code: an RPC, or a trigger fired by the stage's own record.
-- Each of those now names itself, just around its visits update, with a
-- transaction-local workflow token (the pattern app.ledger_payment and
-- app.allow_price_unlock already use). The validator accepts a token only for that
-- workflow's own pairs and checks the actor itself. A change with no token is a
-- direct table write, and only the gate release (gate at its own site, or the
-- owner) is allowed that way. A client cannot set the token: set_config is not
-- exposed through the API, and the setting ends with the transaction.
--
-- Retired pairs (evidence at 0158 in production: state_changed events by pair, and
-- callers in code):
--   in_receiving → awaiting_manager       0 events; no caller
--   awaiting_manager → in_qc / pricing     0 events; only approve_visit_by_manager
--                                          (no app caller); 0 visits in that state
--   pricing → in_accounting                0 events; no caller
--   pricing → stocked                      1 event, 2026-07-13 (pre-ledger); no caller
--   in_accounting → awaiting_stock_intake  12 events, last 2026-07-14; no caller
--   awaiting_stock_intake → stocked        12 events, last 2026-07-14; only the dead
--                                          recordPurchaseIntake action and a stock-intake
--                                          statement that now matches no row
-- Kept: pricing → exited — close_dressing_only accepts pricing and the dressing-only
-- control is offered while the visit is in receiving or pricing.
--
-- Also: close_dressing_only now lets the GM close on any site (GM parity). Its
-- other checks are unchanged. approve_visit_by_manager is left in place: it sets no
-- token and targets only retired pairs, so it can no longer move a visit.
--
-- Error codes: VT001 (not this workflow / not this actor / direct write),
-- VT002 (prerequisite: unpaid stocking, or a settlement still present). No data is
-- rewritten. Five production visits are stocked with no settlement (the known
-- settlement-less lots); 0159 checks future transitions and leaves them alone.

-- ── 1. The validator ─────────────────────────────────────────────────────────
create or replace function public._visits_validate_transition()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_token text := coalesce(current_setting('app.visit_transition', true), '');
  v_pair text := OLD.state || '>' || NEW.state;
  v_role text := public.current_role()::text;
  v_own_site boolean := coalesce(OLD.site_id = public.current_site(), false);
  v_owner boolean := coalesce(public.is_owner(), false);
  v_gm boolean := coalesce(public.is_general_manager(), false);
  v_gacct boolean := coalesce(public.is_general_accountant(), false);
  v_allowed boolean;
  has_analysis boolean; has_submitted_xrf boolean; has_lines boolean; all_exempt boolean; has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;

  -- ── 1. Pair + actor ─────────────────────────────────────────────────────────
  -- A state change with no workflow token is a direct table write. The one direct
  -- write the application makes is the gate releasing a supplier; nothing else,
  -- for any role, the owner and the service role included.
  if v_token = '' then
    v_allowed := v_pair = 'awaiting_gate_exit>exited'
                 and (v_owner or (v_role = 'gate' and v_own_site));
  else
    -- A token names the trusted workflow making the change. It authorises only
    -- that workflow's own pairs, and the actor is checked here again, against the
    -- same authority the workflow itself enforces.
    v_allowed := case v_token
      when 'processing_complete' then v_pair = 'in_processing>in_receiving'
           and (v_owner or (v_role = 'processing' and v_own_site))
      when 'receiving_analysis' then v_pair = 'in_receiving>pricing'
           and (v_owner or (v_role = 'receiving' and v_own_site))
      when 'submit_to_qc' then v_pair = 'in_receiving>in_qc'
           and (v_owner or v_gm or (v_role = 'receiving' and v_own_site))
      when 'reopen_receiving' then v_pair = 'in_qc>in_receiving'
           and (v_owner or v_gm or (v_role in ('receiving', 'manager') and v_own_site))
      when 'qc_complete' then v_pair = 'in_qc>pricing'
           and v_role = 'qc'
      when 'skip_to_pricing' then v_pair = 'in_qc>pricing'
           and (v_owner or v_gm or (v_role = 'manager' and v_own_site))
      when 'pricing_decision' then v_pair in ('pricing>awaiting_price_approval', 'pricing>awaiting_gate_exit')
           and (v_owner or v_gm or (v_role = 'manager' and v_own_site))
      when 'dressing_close' then v_pair in ('in_receiving>exited', 'pricing>exited')
           and (v_owner or v_gm or (v_role in ('processing', 'manager') and v_own_site))
      when 'approve_pricing' then v_pair = 'awaiting_price_approval>in_accounting'
           and v_owner
      when 'reject_pricing' then v_pair = 'awaiting_price_approval>pricing'
           and v_owner
      when 'accountant_send_back' then v_pair = 'in_accounting>awaiting_price_approval'
           and (v_owner or v_gacct or (v_role = 'accounting' and v_own_site))
      when 'payable_send_back' then v_pair = 'in_accounting>pricing'
           and (v_owner or v_gm or v_gacct or (v_role in ('manager', 'accounting') and v_own_site))
      when 'stock_intake' then v_pair = 'in_accounting>stocked'
           and (v_owner or v_gm or v_gacct or (v_role in ('accounting', 'manager', 'inventory') and v_own_site))
      when 'reverse_paid_supply' then v_pair = 'stocked>pricing'
           and (v_owner or v_gacct or (v_role = 'accounting' and v_own_site))
      else false
    end;
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'You cannot move this visit to that stage.' using errcode = 'VT001';
  end if;

  -- ── 2. Prerequisites ────────────────────────────────────────────────────────
  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot advance without material lines'; end if;
  end if;
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (select 1 from public.visit_materials vm join public.xrf_records x on x.visit_material_id = vm.id
                   where vm.visit_id = NEW.id and x.submitted) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis) into all_exempt;
    if OLD.state not in ('awaiting_price_approval', 'in_accounting', 'stocked')
       and not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;
  if v_pair = 'awaiting_gate_exit>exited' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id) into has_authorization;
    if not has_authorization then raise exception 'cannot release without a gate exit authorization'; end if;
  end if;
  -- Stocking is the paid settlement's stock intake; nothing stocks an unpaid batch.
  if NEW.state = 'stocked'
     and not exists (select 1 from public.batch_settlements where visit_id = NEW.id and status = 'paid') then
    raise exception 'This visit cannot be stocked until its settlement is paid.' using errcode = 'VT002';
  end if;
  -- Moving back to pricing / approval, or out as dressing-only, happens only once
  -- the settlement is gone — through the protected send-back / reversal paths
  -- (0156, 0158), never around them.
  if v_pair in ('in_accounting>pricing', 'in_accounting>awaiting_price_approval', 'stocked>pricing',
                'awaiting_price_approval>pricing', 'in_receiving>exited', 'pricing>exited')
     and exists (select 1 from public.batch_settlements where visit_id = NEW.id) then
    raise exception 'This visit still has a settlement, so it cannot move to that stage.' using errcode = 'VT002';
  end if;

  if NEW.state in ('exited', 'stocked') and OLD.state not in ('exited', 'stocked') then
    NEW.closed_at := now();
  end if;
  return NEW;
end; $function$;

-- ── 2. Trusted workflows name themselves around their visits update ─────────
-- Bodies are the 0158 definitions, unchanged apart from the token lines (and the
-- GM clause in close_dressing_only).

-- _processing_records_after → token 'processing_complete'
CREATE OR REPLACE FUNCTION public._processing_records_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    -- Audit
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'processing_records', 'record_id', NEW.id));

    -- Transition: in_processing → in_receiving
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_processing' then
      perform set_config('app.visit_transition', 'processing_complete', true);
      update public.visits set state = 'in_receiving' where id = NEW.visit_id;
      perform set_config('app.visit_transition', '', true);
    end if;

    return NEW;
  end if;

  -- UPDATE: record_edited
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'processing_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));
  return NEW;
end;
$function$;

-- _analysis_records_after → token 'receiving_analysis'
CREATE OR REPLACE FUNCTION public._analysis_records_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'analysis_records', 'record_id', NEW.id));

    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_receiving' then
      perform set_config('app.visit_transition', 'receiving_analysis', true);
      update public.visits set state = 'pricing' where id = NEW.visit_id;
      perform set_config('app.visit_transition', '', true);
    end if;
    return NEW;
  end if;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'analysis_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));

  -- If weight changed, recompute pricing.purchase_amount by touching the pricing row
  if NEW.weight is distinct from OLD.weight then
    update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  end if;

  return NEW;
end;
$function$;

-- submit_visit_to_manager → token 'submit_to_qc'
CREATE OR REPLACE FUNCTION public.submit_visit_to_manager(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text; n_total int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'receiving' and v_site = public.current_site())), false) then
    raise exception 'not authorized to submit this visit';
  end if;
  if v_state <> 'in_receiving' then raise exception 'visit is not in receiving'; end if;
  select count(*) into n_total from public.visit_materials where visit_id = p_visit_id;
  if n_total = 0 then raise exception 'cannot submit without material lines'; end if;
  -- Every batch is weighed by QC, whether or not any line needs an XRF.
  perform set_config('app.visit_transition', 'submit_to_qc', true);
  update public.visits set state = 'in_qc' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);
end; $function$;

-- reopen_receiving → token 'reopen_receiving'
CREATE OR REPLACE FUNCTION public.reopen_receiving(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() in ('receiving', 'manager') and v_site = public.current_site())), false) then
    raise exception 'not authorized to reopen receiving on this visit';
  end if;
  if v_state <> 'in_qc' then
    raise exception 'only a batch waiting in QC can be reopened for receiving (state: %)', v_state;
  end if;
  perform set_config('app.visit_transition', 'reopen_receiving', true);
  update public.visits set state = 'in_receiving' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);
end; $function$;

-- _xrf_records_after → token 'qc_complete'
CREATE OR REPLACE FUNCTION public._xrf_records_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    perform set_config('app.visit_transition', 'qc_complete', true);
    update public.visits set state = 'pricing' where id = v_visit;
    perform set_config('app.visit_transition', '', true);
  end if;

  return NEW;
end; $function$;

-- manager_skip_to_pricing → token 'skip_to_pricing'
CREATE OR REPLACE FUNCTION public.manager_skip_to_pricing(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())), false) then
    raise exception 'not authorized to skip analysis for this visit';
  end if;
  if v_state <> 'in_qc' then raise exception 'visit is not in analysis'; end if;
  update public.visit_materials set requires_analysis = false where visit_id = p_visit_id;
  perform set_config('app.visit_transition', 'skip_to_pricing', true);
  update public.visits set state = 'pricing' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);
end; $function$;

-- _pricing_after → token 'pricing_decision'
CREATE OR REPLACE FUNCTION public._pricing_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; target_state text := null; v_diff jsonb;
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
    v_diff := public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW));
    if v_diff <> '{}'::jsonb then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.visit_id, 'record_edited', auth.uid(),
              jsonb_build_object('table', 'pricing', 'record_id', NEW.id, 'diff', v_diff));
    end if;
  end if;

  if NEW.agreement_status = 'agreed'      then target_state := 'awaiting_price_approval'; end if;
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      perform set_config('app.visit_transition', 'pricing_decision', true);
      update public.visits set state = target_state where id = NEW.visit_id;
      perform set_config('app.visit_transition', '', true);
    end if;
  end if;

  return NEW;
end; $function$;

-- close_dressing_only → token 'dressing_close'
CREATE OR REPLACE FUNCTION public.close_dressing_only(p_visit_id uuid, p_carry boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_site uuid; v_role text; v_has_bill boolean;
begin
  v_role := public.current_role();
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner() or public.is_general_manager()
          or (v_role in ('processing', 'manager') and v_site = public.current_site())), false) then
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

  -- Carry the light bill to the customer's account, or (cash) leave it settled.
  update public.utility_charges set carried = coalesce(p_carry, true)
    where visit_id = p_visit_id and kind = 'light_bill';
  perform set_config('app.visit_transition', 'dressing_close', true);
  update public.visits set dressing_only = true, state = 'exited' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);
end; $function$;

-- approve_pricing → token 'approve_pricing'
CREATE OR REPLACE FUNCTION public.approve_pricing(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_site uuid; t record; v_settle_id uuid;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;

  -- The settlement is replaced below. Lock it first (settlement before lines
  -- and visit, as payments do) and refuse if it carries payment history.
  select id into v_settle_id from public.batch_settlements
    where visit_id = p_visit_id and status <> 'paid'
    for update;
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  update public.visit_materials set price_finalized = true where visit_id = p_visit_id;
  perform set_config('app.visit_transition', 'approve_pricing', true);
  update public.visits set state = 'in_accounting' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);

  select * into t from public.settlement_totals(p_visit_id);
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  insert into public.batch_settlements
    (visit_id, site_id, materials_total, light_bill_total, other_deductions_total,
     advance_deducted, net_balance, remaining_debt, submitted_by, status, approved_by, approved_at)
  values
    (p_visit_id, v_site, t.materials, t.processing_fee, t.other_deductions,
     t.advances, t.net, t.remaining_debt, auth.uid(), 'approved', auth.uid(), now());
end; $function$;

-- reject_pricing → token 'reject_pricing'
CREATE OR REPLACE FUNCTION public.reject_pricing(p_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_owner() then raise exception 'only the owner can reject pricing'; end if;
  perform set_config('app.visit_transition', 'reject_pricing', true);
  update public.visits set state = 'pricing'
    where id = p_visit_id and state = 'awaiting_price_approval';
  perform set_config('app.visit_transition', '', true);
end; $function$;

-- accountant_send_back_to_owner → token 'accountant_send_back'
CREATE OR REPLACE FUNCTION public.accountant_send_back_to_owner(p_visit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_site uuid; v_settle text; v_settle_id uuid;
begin
  if not coalesce((public.current_role() = 'accounting' or public.is_owner()), false) then
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
  if not coalesce((public.is_owner() or public.is_general_accountant() or v_site = public.current_site()), false) then
    raise exception 'no access to this site';
  end if;

  -- Lock before reading, the lock order record_settlement_payment uses.
  select id, status into v_settle_id, v_settle from public.batch_settlements
    where visit_id = p_visit_id order by created_at desc limit 1
    for update;
  if v_settle = 'paid' then
    raise exception 'this batch is already paid — record a price correction instead';
  end if;
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  -- Void the approved settlement + unlock line prices, restoring the normal
  -- 'awaiting_price_approval' state (priced, not yet finalized). The owner then
  -- re-approves or sends it on to the manager.
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  perform set_config('app.allow_price_unlock', 'on', true); -- transaction-local
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  perform set_config('app.visit_transition', 'accountant_send_back', true);
  update public.visits set state = 'awaiting_price_approval' where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site,
          '↩︎ Returned by accounting for the owner to review: ' || btrim(p_reason),
          auth.uid());
end; $function$;

-- send_settlement_back → token 'payable_send_back'
CREATE OR REPLACE FUNCTION public.send_settlement_back(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid; v_status text; v_visit uuid;
begin
  select site_id, status, visit_id into v_site, v_status, v_visit from public.batch_settlements
    where id = p_id
    for update;
  if v_site is null then raise exception 'settlement not found'; end if;
  if not public._can_review_payable(v_site) then raise exception 'not allowed to send this back'; end if;
  if v_status not in ('approved', 'on_hold') then
    raise exception 'only an approved or held (unpaid) settlement can be sent back';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  if exists (select 1 from public.settlement_payments where settlement_id = p_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  delete from public.batch_settlements where id = p_id;
  perform set_config('app.allow_price_unlock', 'on', true);
  update public.visit_materials set price_finalized = false where visit_id = v_visit;
  perform set_config('app.visit_transition', 'payable_send_back', true);
  update public.visits set state = 'pricing' where id = v_visit;
  perform set_config('app.visit_transition', '', true);
  insert into public.batch_comments (visit_id, site_id, body, author)
  values (v_visit, v_site, '↩︎ Payment sent back by ' || public.current_role() || ' for correction: ' || btrim(p_reason), auth.uid());
end; $function$;

-- _batch_settlements_stock_on_paid → token 'stock_intake'
CREATE OR REPLACE FUNCTION public._batch_settlements_stock_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vm record;
  v_supplier uuid;
begin
  if NEW.status = 'paid' and OLD.status is distinct from 'paid' then
    -- 0159: the stock intake below is the trusted workflow that stocks the visit.
    perform set_config('app.visit_transition', 'stock_intake', true);
    select supplier_id into v_supplier from public.visits where id = NEW.visit_id;
    -- Released lines left on a gate pass, and an unpriced line was never
    -- bought — neither becomes stock.
    for vm in
      select * from public.visit_materials
       where visit_id = NEW.visit_id
         and coalesce(settlement_status, 'settled') <> 'unsettled'
         and unit_price is not null
    loop
      if vm.weight_kg > 0 then
        insert into public.stock_lots (
          site_id, material_type_id, supplier_id, ref_visit_material_id,
          weight_kg, cost_price_per_kg, recorded_by
        ) values (
          NEW.site_id, vm.material_type_id, v_supplier, vm.id,
          vm.weight_kg, vm.unit_price, NEW.paid_by
        );
        -- The ledger 'in' movement also drives the visit → 'stocked' transition
        -- (via _stock_movements_after) and feeds the stock_balances view.
        insert into public.stock_movements (
          site_id, material_type_id, grade, weight, direction, recorded_by, reason, ref_visit_id
        ) values (
          NEW.site_id, vm.material_type_id, null, vm.weight_kg, 'in', NEW.paid_by, 'purchase_intake', NEW.visit_id
        );
      end if;
    end loop;

    -- A batch whose every line was released or unpriced still has to leave
    -- awaiting_stock_intake, or it would sit in the queue forever.
    update public.visits set state = 'stocked'
     where id = NEW.visit_id and state = 'awaiting_stock_intake';
    perform set_config('app.visit_transition', '', true);
  end if;
  return NEW;
end; $function$;

-- reverse_paid_supply → token 'reverse_paid_supply'
CREATE OR REPLACE FUNCTION public.reverse_paid_supply(p_visit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_settle uuid; v_status text; v_site uuid;
begin
  if not coalesce((public.current_role() = 'accounting' or public.is_owner()), false) then
    raise exception 'only accounting may reverse a paid supply';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason (refund confirmation) is required'; end if;

  select id, status, site_id into v_settle, v_status, v_site
    from public.batch_settlements where visit_id = p_visit_id;
  if v_settle is null then raise exception 'no settlement to reverse'; end if;
  if v_status <> 'paid' then raise exception 'only a paid supply can be reversed'; end if;
  if not coalesce((public.is_owner() or public.is_general_accountant() or v_site = public.current_site()), false) then
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
  perform set_config('app.visit_transition', 'reverse_paid_supply', true);
  update public.visits set state = 'pricing', dressing_only = false, closed_at = null where id = p_visit_id;
  perform set_config('app.visit_transition', '', true);

  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site, '↩︎ Paid supply reversed (supplier refund confirmed): ' || btrim(p_reason), auth.uid());
end; $function$;
