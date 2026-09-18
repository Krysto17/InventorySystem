-- 0161 — Financial and stock integrity guards (Phase 3F-T6: F-07, F-08, F-10)
--
-- Three narrow fixes. No reversal accounting, no audit overhaul, no new workflow.
--
-- ── F-07: deleting a deduction re-creates debt the supplier already settled ──
-- 0158 (SF004) already froze every deduction whose OWN visit carries a
-- settlement, and that closed the originally reported case for visit-linked
-- rows: LOCAL proves accounting, the owner and the service role are all refused
-- on an approved, partially paid or paid batch. What it does not see is the
-- SUPPLIER-level snapshot. `batch_settlements.remaining_debt` is written at
-- approval from supplier_outstanding_debt(), which subtracts every advance-kind
-- deduction of that supplier — the standalone ones (ref_visit_id is null, 13 in
-- production) included — and SF001 freezes that column afterwards. Deleting such
-- a deduction therefore rewrites a figure a finalized settlement already
-- reported: LOCAL walked ₦100,000 of debt back twice through rows no trigger
-- watched, as accounting and as the service role, leaving no audit row (the
-- AFTER trigger only fires for visit-linked deductions).
--
-- The guard is the smallest statement of that: an advance-kind deduction cannot
-- be deleted once a settlement snapshot for the same supplier has been taken at
-- or after it (AD001). Before that point deletion stays exactly as it was, so a
-- mistake recorded moments ago is still correctable. Processing-kind deductions
-- are deliberately untouched: while a visit carries them they are frozen by
-- SF004 (settlement_totals counts every kind on the visit), and a standalone
-- processing deduction feeds no frozen snapshot, so there is nothing to prove a
-- finalized outcome against. Recording a correcting entry, not deletion, is the
-- answer once accounts are finalized; building that adjustment workflow is not
-- T6.
--
-- approve_pricing is re-emitted with one added line: it takes the supplier row
-- FOR SHARE before reading the totals it is about to freeze. Without it the race
-- is open — a delete that commits while an approval is between reading the debt
-- and writing the snapshot would leave exactly the inconsistency AD001 exists to
-- prevent. The guard takes the same row FOR UPDATE, so the two serialise. Lock
-- order is unchanged and consistent: settlement -> visit -> supplier.
--
-- ── F-08: reversal could leave the stock bucket short ────────────────────────
-- reverse_paid_supply checked that the lots it created are still `available`,
-- unmixed, unsold and not gate-passed — but it took NO locks at all, and it
-- never looked at the bucket. The intake it deletes may be what backs stock
-- somebody else has already taken out: LOCAL drove a bucket to -90 kg with every
-- one of this visit's own lots untouched (150 kg in, a 50 kg mixed batch and a
-- 90 kg bulk sale out, then the 100 kg intake deleted). It also reversed happily
-- while the bucket was already negative.
--
-- The rewrite keeps the existing reversal semantics — this is the one workflow
-- whose design is to undo an intake, and the deletes it performs are what
-- "reverse" means here (recorded under F-12 as the traceability gap it is, not
-- widened here) — and adds what was missing:
--   * the settlement row is locked and its status re-read under that lock;
--   * every bucket the intake touches is locked (advisory, ordered), then every
--     lot (FOR UPDATE, ordered) — bucket -> lot, the 0153/0155/0160 order, so no
--     path can invert it;
--   * eligibility is re-checked under those locks, not before them;
--   * the bucket must still balance once the intake is removed;
--   * only then does anything get written, so a refusal changes nothing.
-- Refusals are RS001; a lot on a live gate pass or in a cost-price run (pending
-- reservation or approved sale) still refuses, as it did.
--
-- ── F-10: inventory could edit another site's expense ────────────────────────
-- The three inventory clauses on `consumables` name the role and never the site,
-- so an inventory user at Old-Site could insert, edit and delete a Dong expense.
-- Manager is already site-scoped in the same policies; inventory now matches it.
-- Owner, general manager and general accountant keep their deliberate cross-site
-- authority, approval semantics are untouched, and SELECT is left as it is —
-- inventory reads every site's stock and expenses by design (0154).

-- ── F-07 ────────────────────────────────────────────────────────────────────
create or replace function public._advance_deductions_delete_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Only advance-kind recoveries reach a frozen snapshot (remaining_debt).
  if OLD.kind <> 'advance' then
    return OLD;
  end if;

  -- Same row the insert/update guards take, so a delete cannot slip between an
  -- approval reading the debt and freezing it.
  perform 1 from public.suppliers where id = OLD.supplier_id for update;

  if exists (
    select 1
      from public.batch_settlements b
      join public.visits v on v.id = b.visit_id
     where v.supplier_id = OLD.supplier_id
       and coalesce(b.approved_at, b.created_at) >= OLD.created_at
  ) then
    raise exception 'This deduction has already been used in finalized accounts and cannot be deleted.'
      using errcode = 'AD001';
  end if;

  return OLD;
end;
$function$;

-- Named to sort AFTER t_advance_deductions_freeze_snapshot: a deduction whose own
-- visit carries a settlement keeps answering with 0158's SF004, which is what the
-- screens already explain ("send the settlement back first"). AD001 is only for
-- what SF004 cannot see — the supplier-level snapshot.
create trigger t_advance_deductions_z_delete_guard
  before delete on public.advance_deductions
  for each row execute function public._advance_deductions_delete_guard();

-- Re-emitted from the body live at 0160 (last defined by 0156); the only change
-- is the supplier FOR SHARE lock marked below. Verified by diffing this body
-- against pg_get_functiondef() on a database reset to 0160: the lock, one blank
-- line and a trailing newline are the whole difference.
create or replace function public.approve_pricing(p_visit_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  -- 0161: remaining_debt below is a supplier-level figure this row freezes, so
  -- hold the supplier while it is read and written. Deduction inserts, updates
  -- and deletes take the same row (FOR UPDATE), and cannot move underneath it.
  perform 1 from public.suppliers
   where id = (select supplier_id from public.visits where id = p_visit_id)
   for share;

  select * into t from public.settlement_totals(p_visit_id);
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';

  insert into public.batch_settlements
    (visit_id, site_id, materials_total, light_bill_total, other_deductions_total,
     advance_deducted, net_balance, remaining_debt, submitted_by, status, approved_by, approved_at)
  values
    (p_visit_id, v_site, t.materials, t.processing_fee, t.other_deductions,
     t.advances, t.net, t.remaining_debt, auth.uid(), 'approved', auth.uid(), now());
end;
$function$;

-- ── F-08 ────────────────────────────────────────────────────────────────────
create or replace function public.reverse_paid_supply(p_visit_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_settle uuid; v_status text; v_site uuid;
  bucket record; it record; lot record;
  v_balance numeric; v_out numeric;
begin
  if not coalesce((public.current_role() = 'accounting' or public.is_owner()), false) then
    raise exception 'only accounting may reverse a paid supply';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason (refund confirmation) is required'; end if;

  -- Settlement first (0151/0156 order), and its status is read under that lock.
  select id, status, site_id into v_settle, v_status, v_site
    from public.batch_settlements where visit_id = p_visit_id for update;
  if v_settle is null then raise exception 'no settlement to reverse'; end if;
  if v_status <> 'paid' then raise exception 'only a paid supply can be reversed'; end if;
  if not coalesce((public.is_owner() or public.is_general_accountant() or v_site = public.current_site()), false) then
    raise exception 'no access to this site';
  end if;

  -- Buckets before lots, both ordered: the order cost-price approval (0153) and
  -- gate acknowledgement (0155) take.
  for bucket in
    select distinct m.site_id, m.material_type_id, coalesce(m.grade, '') as grade
      from public.stock_movements m
     where m.ref_visit_id = p_visit_id and m.reason = 'purchase_intake' and m.direction = 'in'
     order by 1, 2, 3
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(bucket.site_id::text || bucket.material_type_id::text || bucket.grade, 0));
  end loop;

  for it in
    select sl.id from public.stock_lots sl
      join public.visit_materials vm on vm.id = sl.ref_visit_material_id
     where vm.visit_id = p_visit_id
     order by sl.id
  loop
    select * into lot from public.stock_lots where id = it.id for update;
    -- Re-checked under the lock, not before it: the sale, release or mixing may
    -- have committed while this transaction was waiting.
    if lot.status <> 'available'
       or exists (select 1 from public.cost_price_run_lots x where x.stock_lot_id = lot.id)
       or exists (select 1 from public.lot_sale_items x where x.stock_lot_id = lot.id)
       or exists (select 1 from public.gate_passes x where x.stock_lot_id = lot.id) then
      raise exception 'This paid supply can no longer be reversed because its stock has already been used.'
        using errcode = 'RS001';
    end if;
  end loop;

  -- The intake may be what backs stock somebody else has already taken out.
  for bucket in
    select m.site_id, m.material_type_id, coalesce(m.grade, '') as grade, sum(m.weight) as w
      from public.stock_movements m
     where m.ref_visit_id = p_visit_id and m.reason = 'purchase_intake' and m.direction = 'in'
     group by 1, 2, 3
  loop
    select coalesce(sum(case when direction = 'in' then weight else -weight end), 0)
      into v_balance
      from public.stock_movements
     where site_id = bucket.site_id
       and material_type_id = bucket.material_type_id
       and coalesce(grade, '') = bucket.grade;
    if v_balance - bucket.w < 0 then
      raise exception 'This paid supply can no longer be reversed because its stock has already been used.'
        using errcode = 'RS001';
    end if;
  end loop;

  -- Eligible under lock: everything below is the reversal itself.
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
end;
$function$;

-- ── F-10 ────────────────────────────────────────────────────────────────────
-- Inventory writes are own-site, exactly as the manager clause beside them.
alter policy "consumables: inventory/manager/owner insert" on public.consumables
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory'::app_role and site_id = public.current_site())
    or (public.current_role() = 'manager'::app_role and site_id = public.current_site())
  );

alter policy "consumables: site roles update own site" on public.consumables
  using (
    public.is_owner()
    or (public.current_role() = 'inventory'::app_role and approval_status = 'pending'
        and site_id = public.current_site())
    or (public.current_role() = any (array['manager'::app_role, 'accounting'::app_role])
        and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory'::app_role and approval_status = 'pending'
        and site_id = public.current_site())
    or (public.current_role() = any (array['manager'::app_role, 'accounting'::app_role])
        and site_id = public.current_site())
  );

alter policy "consumables: manager/owner delete unpaid" on public.consumables
  using (
    approval_status <> 'paid'::text
    and (
      public.is_owner()
      or public.is_general_manager()
      or (public.current_role() = 'inventory'::app_role and approval_status = 'pending'
          and site_id = public.current_site())
      or (public.current_role() = 'manager'::app_role and site_id = public.current_site())
    )
  );
