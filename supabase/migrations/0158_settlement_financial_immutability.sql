-- ─── 0158: an approved settlement is a snapshot nobody edits underneath ─────
-- approve_pricing (0089, 0156) creates the settlement by INSERT, copying
-- settlement_totals(visit) into it:
--
--   visit_materials.weight_kg × unit_price  -> purchase_amount (trigger)
--     sum over lines with settlement_status = 'settled'      -> materials_total
--   utility_charges light_bill, not carried                  -> light_bill_total
--   utility_charges other                                    -> other_deductions_total
--   advance_deductions with ref_visit_id = visit             -> advance_deducted
--   materials − light_bill − other − advances                -> net_balance
--   supplier_outstanding_debt(supplier) at approval          -> remaining_debt
--
-- No function ever UPDATEs those columns afterwards: every settlement UPDATE in
-- the schema is a status transition (hold, release, payment, close). Audit 3F
-- (F-04) and T2/T3 still found three ways to break the snapshot:
--
--   * a direct table UPDATE: an accountant set net_balance 100,000 -> 250,000
--     and then paid 250,000; the GM, general accountant and owner hold the same
--     UPDATE right;
--   * while the approved batch is still unpaid the visit stays "open", so a line
--     edit (weight, price, material, unsettle, add, remove) moves the batch total
--     away from the settlement being paid (found again in T2);
--   * the other two sources move the same way: a utility charge added, discounted
--     or removed (or a processing-fee re-sync) and a deduction added, edited or
--     removed against the visit. Production has a paid settlement whose light-bill
--     figure is ₦7,500 above today's charges.
--
-- Business ruling 3F-T3: once pricing approval creates the settlement, its amounts
-- are fixed. So is every source that settlement_totals reads — the material lines,
-- the visit's utility charges and its advance deductions — for every role and for
-- direct service-role writes. To correct pricing the settlement is first sent back
-- through the existing workflow (zero payments only, 0156). Once it is gone the
-- sources are editable again under their normal rules.
--
-- Every source guard locks the visit row FOR SHARE before looking for a settlement.
-- approve_pricing updates that row before it totals the sources, so a source change
-- and an approval serialise. Whichever commits first is seen by the other.

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
-- (1) Every settlement's own arithmetic holds.
-- (2) Every settlement still UNPAID equals its live sources today, component by
--     component. Those are the snapshots this migration starts protecting, so they
--     must be right now.
-- PAID settlements are deliberately not compared with live sources. A paid
-- settlement records what was paid; historical drift in its sources (one known
-- ₦7,500 light-bill case) is a reconciliation matter. This migration stops new
-- drift and does not repair or rewrite the past.
do $$
declare n integer;
begin
  select count(*) into n from public.batch_settlements
   where abs(net_balance - (materials_total - light_bill_total - other_deductions_total - advance_deducted)) > 0.01;
  if n > 0 then
    raise exception '0158 precondition 1 failed: % settlement(s) whose net_balance does not equal its components', n;
  end if;

  select count(*) into n
    from public.batch_settlements b, lateral public.settlement_totals(b.visit_id) t
   where b.status <> 'paid'
     and (abs(b.materials_total - t.materials) > 0.01
       or abs(b.light_bill_total - t.processing_fee) > 0.01
       or abs(b.other_deductions_total - t.other_deductions) > 0.01
       or abs(b.advance_deducted - t.advances) > 0.01
       or abs(b.net_balance - t.net) > 0.01);
  if n > 0 then
    raise exception '0158 precondition 2 failed: % unpaid settlement(s) no longer match their live sources', n;
  end if;
end $$;

-- ── 1. Settlement amounts: written once, at approval ─────────────────────────
-- Frozen: the six money figures, plus visit_id and site_id, which anchor the
-- snapshot to the batch it describes and decide which site may pay it. Status and
-- the approved/paid/held stamps stay with _batch_settlements_transition. No bypass
-- because nothing legitimate ever needs one.
create or replace function public._batch_settlements_freeze_amounts()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.materials_total        is distinct from OLD.materials_total
     or NEW.light_bill_total       is distinct from OLD.light_bill_total
     or NEW.other_deductions_total is distinct from OLD.other_deductions_total
     or NEW.advance_deducted       is distinct from OLD.advance_deducted
     or NEW.net_balance            is distinct from OLD.net_balance
     or NEW.remaining_debt         is distinct from OLD.remaining_debt
     or NEW.visit_id               is distinct from OLD.visit_id
     or NEW.site_id                is distinct from OLD.site_id then
    raise exception 'Approved settlement amounts cannot be edited directly.'
      using errcode = 'SF001';
  end if;
  return NEW;
end; $$;

create trigger t_batch_settlements_freeze_amounts
  before update on public.batch_settlements
  for each row execute function public._batch_settlements_freeze_amounts();

-- ── 2. Line figures under an existing settlement: UPDATE ─────────────────────
-- Replaces the 0157 body. It still takes the settlement SHARE NOWAIT lock (the
-- payment race) and still locks closed batches that have no settlement for
-- everyone but the owner. New: settlement_status is watched too (it decides
-- whether a line counts), and ANY existing settlement refuses the change for
-- every caller.
--
-- Race with approve_pricing: approval UPDATEs every line of the visit before it
-- totals them. Whichever of the two takes the line row lock first, the other
-- waits. An edit that commits first is in the snapshot; an edit that waited
-- re-checks here and finds the settlement.
create or replace function public._visit_materials_finalised_lock()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.weight_kg is not distinct from OLD.weight_kg
     and NEW.unit_price is not distinct from OLD.unit_price
     and NEW.material_type_id is not distinct from OLD.material_type_id
     and NEW.settlement_status is not distinct from OLD.settlement_status then
    return NEW;
  end if;

  begin
    perform 1 from public.batch_settlements where visit_id = NEW.visit_id for share nowait;
  exception when lock_not_available then
    raise exception 'This batch is being settled right now — try again in a moment.'
      using errcode = 'VM002';
  end;

  if exists (select 1 from public.batch_settlements where visit_id = NEW.visit_id) then
    raise exception 'This pricing is already approved. Send the settlement back before changing the material.'
      using errcode = 'SF002';
  end if;

  if auth.uid() is not null and not public.is_owner()
     and not public.visit_is_open(NEW.visit_id) then
    raise exception 'This material line is locked — its batch has been finalised.'
      using errcode = 'VM001';
  end if;
  return NEW;
end; $$;

-- ── 3. Line membership under an existing settlement: INSERT / DELETE ─────────
-- Adding or removing a line (remove_line, a direct delete, an owner insert) moves
-- materials_total just as a price edit does.
--   INSERT: take the visit row SHARE lock first. approve_pricing updates the visit
--           before it totals the lines, so the two serialise, and whichever
--           commits first is seen by the other.
--   DELETE: the line row lock already serialises with approval. A delete with no
--           visit row left is delete_batch's cascade removing the whole batch,
--           settlement included, so there is nothing left to disagree with.
create or replace function public._visit_materials_settlement_membership()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_visit uuid;
begin
  if TG_OP = 'INSERT' then
    v_visit := NEW.visit_id;
    perform 1 from public.visits where id = v_visit for share;
  else
    v_visit := OLD.visit_id;
    if not exists (select 1 from public.visits where id = v_visit) then
      return OLD;
    end if;
  end if;

  if exists (select 1 from public.batch_settlements where visit_id = v_visit) then
    raise exception 'This pricing is already approved. Send the settlement back before changing the material.'
      using errcode = 'SF002';
  end if;

  if TG_OP = 'INSERT' then
    return NEW;
  end if;
  return OLD;
end; $$;

create trigger t_visit_materials_settlement_membership
  before insert or delete on public.visit_materials
  for each row execute function public._visit_materials_settlement_membership();

-- ── 4. Utility charges under an existing settlement ──────────────────────────
-- settlement_totals counts a charge as light_bill_total when kind = 'light_bill'
-- and not carried, and as other_deductions_total when kind = 'other'. An UPDATE
-- is refused only when it changes what the charge contributes: amount, kind,
-- carried (for a light bill) or the visit it belongs to. Description edits pass.
-- INSERT and DELETE are refused outright. A DELETE whose visit is already gone is
-- delete_batch's cascade removing the whole batch, settlement included.
create or replace function public._utility_charges_freeze_snapshot()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_visits uuid[]; v uuid;
begin
  if TG_OP = 'UPDATE' then
    if NEW.visit_id = OLD.visit_id
       and (case when NEW.kind = 'light_bill' and not NEW.carried then NEW.amount else 0 end)
         = (case when OLD.kind = 'light_bill' and not OLD.carried then OLD.amount else 0 end)
       and (case when NEW.kind = 'other' then NEW.amount else 0 end)
         = (case when OLD.kind = 'other' then OLD.amount else 0 end) then
      return NEW;
    end if;
    v_visits := array[OLD.visit_id, NEW.visit_id];
  elsif TG_OP = 'INSERT' then
    v_visits := array[NEW.visit_id];
  else
    if not exists (select 1 from public.visits where id = OLD.visit_id) then
      return OLD;
    end if;
    v_visits := array[OLD.visit_id];
  end if;

  for v in select distinct x from unnest(v_visits) as x order by x loop
    perform 1 from public.visits where id = v for share;
    if exists (select 1 from public.batch_settlements where visit_id = v) then
      raise exception 'Utility charges cannot be changed after pricing is approved.'
        using errcode = 'SF003';
    end if;
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end; $$;

create trigger t_utility_charges_freeze_snapshot
  before insert or update or delete on public.utility_charges
  for each row execute function public._utility_charges_freeze_snapshot();

-- ── 5. Visit-linked advance deductions under an existing settlement ──────────
-- settlement_totals counts every deduction with ref_visit_id = visit, whatever its
-- kind, into advance_deducted. Refused while that visit has a settlement: an
-- INSERT or DELETE of a visit-linked row, and an UPDATE that changes the amount or
-- moves the row to or from a visit. Kind, supplier and notes do not change the
-- snapshot and pass. Deductions with no visit (record_debt_repayment) are
-- untouched.
--
-- The trigger is named to fire BEFORE the 0153 insert guard and the 0157 update
-- guard, so on both paths the order is visit share lock first, then the supplier
-- lock. A refusal here happens before any supplier lock is taken.
create or replace function public._advance_deductions_freeze_snapshot()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_visits uuid[]; v uuid;
begin
  if TG_OP = 'UPDATE' then
    if NEW.ref_visit_id is not distinct from OLD.ref_visit_id and NEW.amount = OLD.amount then
      return NEW;
    end if;
    v_visits := array[OLD.ref_visit_id, NEW.ref_visit_id];
  elsif TG_OP = 'INSERT' then
    v_visits := array[NEW.ref_visit_id];
  else
    v_visits := array[OLD.ref_visit_id];
  end if;

  for v in select distinct x from unnest(v_visits) as x where x is not null order by x loop
    perform 1 from public.visits where id = v for share;
    if exists (select 1 from public.batch_settlements where visit_id = v) then
      raise exception 'Advance deductions cannot be changed after pricing is approved.'
        using errcode = 'SF004';
    end if;
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end; $$;

create trigger t_advance_deductions_freeze_snapshot
  before insert or update or delete on public.advance_deductions
  for each row execute function public._advance_deductions_freeze_snapshot();

-- ── 6. Processing-fee correction: one transaction, refused before any write ──
-- The processing employee's fee correction used to be three separate requests:
-- delete the machine usage, insert the new usage, then sync_processing_fee. Each
-- committed on its own. Under an approved settlement the sync is refused (§4), and
-- the usage rows had already been replaced. Reproduced locally: usage 100 × 10
-- became 500 × 20 while the save failed and the fee stayed put.
--
-- resave_processing_fee does all of it in one transaction. The authorisation
-- mirrors the action and the usage write policy (owner, or processing on an open
-- visit at its own site with the fee sent back). The visit row is then locked FOR
-- SHARE, as the other source guards do, and an existing settlement is refused with
-- SF003 before anything is written. Otherwise the usage is replaced and the fee is
-- re-synced in the same transaction, so any error leaves no trace. Rates come from
-- the machines the caller can see, exactly as the action read them.
create or replace function public.resave_processing_fee(p_visit_id uuid, p_usage jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_rec uuid; v_reopened boolean;
begin
  select site_id into v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not coalesce((public.is_owner()
          or (public.current_role() = 'processing' and v_site = public.current_site())), false) then
    raise exception 'not authorized';
  end if;
  if not public.is_owner() and not coalesce(public.visit_is_open(p_visit_id), false) then
    raise exception 'this visit is closed';
  end if;

  select id, fee_reopened into v_rec, v_reopened
    from public.processing_records where visit_id = p_visit_id
    order by created_at desc limit 1;
  if v_rec is null then raise exception 'no processing record'; end if;
  if not coalesce(v_reopened, false) and not public.is_owner() then
    raise exception 'fee is not open for correction';
  end if;

  perform 1 from public.visits where id = p_visit_id for share;
  if exists (select 1 from public.batch_settlements where visit_id = p_visit_id) then
    raise exception 'This pricing is already approved. Send the settlement back before changing the processing fee.'
      using errcode = 'SF003';
  end if;

  delete from public.processing_machine_usage where processing_record_id = v_rec;
  insert into public.processing_machine_usage (processing_record_id, machine_id, measurement, rate_snapshot)
  select v_rec, (u->>'machine_id')::uuid, (u->>'measurement')::numeric, coalesce(m.rate, 0)
    from jsonb_array_elements(coalesce(p_usage, '[]'::jsonb)) as u
    left join public.machines m
      on m.id = (u->>'machine_id')::uuid
     and (public.is_owner() or m.site_id = public.current_site())
   where nullif(u->>'machine_id', '') is not null
     and (u->>'measurement')::numeric > 0;

  perform public.sync_processing_fee(p_visit_id);
end; $$;

revoke execute on function public.resave_processing_fee(uuid, jsonb) from public, anon;
grant  execute on function public.resave_processing_fee(uuid, jsonb) to authenticated, service_role;
