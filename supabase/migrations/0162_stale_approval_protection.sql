-- 0162 — Stale approval protection (Phase 3F-T7: F-09)
--
-- An approval could commit against a version of a record the approver never
-- saw. LOCAL 0161 proof: the owner reviewed a ₦5,000 expense, inventory edited
-- it to ₦500,000 while the owner was deciding, and the owner's approval landed
-- on ₦500,000 — which was then paid. The same for advances: ₦10,000 reviewed,
-- ₦900,000 approved and paid, and the supplier carried ₦900,000 of debt that
-- nobody approved.
--
-- The rule this migration enforces is the business ruling: an approval applies
-- only to the exact version that was reviewed. If the record moved, the
-- approval fails (ST001) and the approver must look again. Nothing is
-- auto-approved, no row is held while a browser page sits open, and no
-- long-lived lock is taken — the row is locked only for the instant the
-- decision is validated and written.
--
-- ── The version token ────────────────────────────────────────────────────────
-- `updated_at` was evaluated first and rejected as the token:
--   * `consumables` has no such column at all;
--   * `advances` has one and it IS maintained (t_advances_before_update sets it
--     on every update), but it is `now()` — the TRANSACTION timestamp — so two
--     edits in one transaction share a value, and it is a timestamp being asked
--     to behave like a counter.
-- So both tables get an explicit integer `revision`, bumped by a BEFORE UPDATE
-- trigger on every update whatever the caller. Existing rows start at 1, which
-- states nothing about the business meaning of any row.
--
-- ── Why a trigger and not just a filtered UPDATE ─────────────────────────────
-- Approval is a plain PostgREST table UPDATE today, so an optimistic filter
-- (`.eq("revision", reviewed)`) added in the app would be trivially bypassed by
-- any direct API caller simply omitting it — and a 0-row answer is
-- indistinguishable from an RLS refusal. The check therefore lives in the
-- database: a pending → approved/rejected transition REQUIRES a transaction
-- local token carrying the reviewed revision, and only the review RPCs set it.
-- A direct table UPDATE carries no token and is refused. This is the same
-- transaction-local token discipline 0159 uses for visit transitions and the
-- existing `app.payable_review` uses for hold/release.
--
-- ── Trigger order ───────────────────────────────────────────────────────────
-- Triggers fire alphabetically, so `t_advances_before_update` and
-- `t_consumables_approval_guard` still answer FIRST: a non-owner keeps getting
-- the existing role error and an illegal transition keeps its existing message.
-- ST001 is only reached by a caller who was allowed to make the decision.

-- ── The token ───────────────────────────────────────────────────────────────
alter table public.consumables add column if not exists revision integer not null default 1;
alter table public.advances    add column if not exists revision integer not null default 1;

create or replace function public._revision_and_stale_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_token text;
begin
  -- A decision on mutable financial content must name the version it reviewed.
  if OLD.approval_status = 'pending'
     and NEW.approval_status in ('approved', 'rejected') then
    v_token := coalesce(current_setting('app.approval_review', true), '');
    if v_token <> OLD.revision::text then
      raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
        using errcode = 'ST001';
    end if;
  end if;

  -- Every update that actually changes the record moves the version, whoever
  -- makes it. An update that writes the same values back is left alone: it
  -- changed nothing the approver reviewed, and bumping it would both invalidate
  -- a perfectly good review and turn a no-op into an audited edit.
  if to_jsonb(NEW) - 'revision' is distinct from to_jsonb(OLD) - 'revision' then
    NEW.revision := OLD.revision + 1;
  end if;
  return NEW;
end;
$function$;

create trigger t_consumables_revision
  before update on public.consumables
  for each row execute function public._revision_and_stale_guard();

create trigger t_advances_revision
  before update on public.advances
  for each row execute function public._revision_and_stale_guard();

-- ── The approval contract ───────────────────────────────────────────────────
-- Both RPCs: lock the row, prove it is still pending, prove the reviewed
-- revision is the current one, and only then write. Nothing happens before the
-- stale check, so a refusal leaves the row exactly as it was.

create or replace function public.review_expense(
  p_id uuid, p_reviewed_revision integer, p_decision text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record;
begin
  if not public.is_owner() then
    raise exception 'only the owner approves expenses';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'choose approve or reject';
  end if;

  select * into r from public.consumables where id = p_id for update;
  if r.id is null then
    raise exception 'expense not found';
  end if;
  if r.approval_status <> 'pending' then
    raise exception 'This expense has already been ruled on.' using errcode = 'ST001';
  end if;
  if r.revision <> p_reviewed_revision then
    raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
      using errcode = 'ST001';
  end if;

  perform set_config('app.approval_review', r.revision::text, true);
  update public.consumables set approval_status = p_decision where id = p_id;
  perform set_config('app.approval_review', '', true);
end;
$function$;

create or replace function public.review_advance(
  p_id uuid, p_reviewed_revision integer, p_decision text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record;
begin
  if not public.is_owner() then
    raise exception 'only the owner approves or rejects an advance';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'choose approve or reject';
  end if;

  select * into r from public.advances where id = p_id for update;
  if r.id is null then
    raise exception 'advance not found';
  end if;
  if r.approval_status <> 'pending' then
    raise exception 'This advance has already been ruled on.' using errcode = 'ST001';
  end if;
  if r.revision <> p_reviewed_revision then
    raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
      using errcode = 'ST001';
  end if;

  perform set_config('app.approval_review', r.revision::text, true);
  update public.advances set approval_status = p_decision where id = p_id;
  perform set_config('app.approval_review', '', true);
end;
$function$;

-- The manager advances screen reads this view, so the version has to travel
-- with the row it belongs to. Appended at the end; every existing column keeps
-- its name, type and position.
-- security_invoker = on is NOT optional and must be restated here: CREATE OR
-- REPLACE VIEW does not inherit the existing reloptions, and without it the view
-- would run with the owner's rights and show every site's advances to a
-- site-scoped manager (0138 set it for exactly this reason).
create or replace view public.advance_list with (security_invoker = on) as
 select a.id,
    a.site_id,
    a.supplier_id,
    sup.name as supplier_name,
    sup.supplier_code,
    a.purpose,
    a.amount_naira,
    a.approval_status,
    a.comment,
    a.account_name,
    a.account_number,
    a.bank_name,
    a.created_at,
    a.revision
   from public.advances a
     left join public.suppliers sup on sup.id = a.supplier_id;

revoke execute on function public.review_expense(uuid, integer, text) from public, anon;
revoke execute on function public.review_advance(uuid, integer, text) from public, anon;
grant execute on function public.review_expense(uuid, integer, text) to authenticated;
grant execute on function public.review_advance(uuid, integer, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- T7 (extended): the same stale-decision defect on the three larger surfaces.
--
-- The reconstruction proved that expenses and advances were not the whole of
-- F-09. LOCAL 0161 also showed:
--   * an APPROVED expense edited ₦5,000 → ₦500,000 and then paid at ₦500,000;
--   * an APPROVED advance edited ₦10,000 → ₦900,000, paid, and the supplier
--     left carrying ₦900,000 of debt nobody approved;
--   * pricing: the owner reviewed ₦5,000, the manager repriced, and the
--     approval FROZE ₦40,000 into the settlement snapshot;
--   * cost-price: the owner reviewed a 100 kg run, a 900 kg lot was attached,
--     and the approval sold 1,000 kg.
-- Same defect, larger money. Each is closed below with the same shape: a
-- reviewed token, validated under lock, before any side effect.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ST002: an approved payable's financial content is immutable ─────────────
-- Approval means something only if what was approved is what gets paid. Once a
-- payable is approved (or held, which is approval paused), the fields that
-- decide how much money moves and to whom are frozen. Status transitions are
-- NOT frozen: approved → paid, the hold/release pair, and the existing
-- send-back workflow (which returns the row to pending with a correction note,
-- the legitimate way to reopen it for editing) all still work untouched.
-- Notes and metadata are deliberately left editable.
create or replace function public._approved_payable_freeze()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fields text[];
  f text;
begin
  if OLD.approval_status not in ('approved', 'on_hold') then
    return NEW;
  end if;

  -- Only the fields that decide how much money moves and to whom. The free-text
  -- description (`name` / `purpose`) and the notes are NOT frozen: they carry no
  -- money and no payee, and correcting the wording of an approved item is
  -- existing, legitimate behaviour.
  if TG_TABLE_NAME = 'consumables' then
    fields := array['amount_naira', 'site_id', 'category',
                    'account_name', 'account_number', 'bank_name'];
  else
    fields := array['amount_naira', 'supplier_id', 'site_id',
                    'account_name', 'account_number', 'bank_name'];
  end if;

  foreach f in array fields loop
    if to_jsonb(NEW) -> f is distinct from to_jsonb(OLD) -> f then
      raise exception 'This approved record cannot be changed. Send it back or reopen it before editing.'
        using errcode = 'ST002';
    end if;
  end loop;
  return NEW;
end;
$function$;

-- Sorts after the existing guards, so a paid row keeps its own message.
create trigger t_consumables_approved_freeze
  before update on public.consumables
  for each row execute function public._approved_payable_freeze();

create trigger t_advances_approved_freeze
  before update on public.advances
  for each row execute function public._approved_payable_freeze();

-- ── Advance shares move debt without touching the advance ───────────────────
-- A share reassigns part of an advance's debt to another supplier, so it
-- changes what an approval means while never writing to `advances`. Any share
-- mutation therefore bumps the parent advance's revision: a review taken before
-- the share is no longer current, exactly as if the amount had been edited.
create or replace function public._advance_share_bumps_parent()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_advance uuid;
begin
  v_advance := coalesce(NEW.advance_id, OLD.advance_id);
  -- Only while the advance is still pending: that is the window a review can be
  -- taken in. Once it is approved or paid the freeze and the paid guard govern,
  -- and touching the row here would break the legitimate redistribution of debt
  -- on an already-paid advance.
  update public.advances set revision = revision + 1
   where id = v_advance and approval_status = 'pending';
  return coalesce(NEW, OLD);
end;
$function$;

create trigger t_advance_shares_bump_parent
  after insert or update or delete on public.advance_shares
  for each row execute function public._advance_share_bumps_parent();

-- ── Pricing: the reviewed version is the whole settlement source set ────────
-- A naive revision on `visits` would prove nothing: the money comes from the
-- lines, the utility charges and the visit's deductions, and settlement_totals
-- also carries the supplier-level remaining_debt that SF001 freezes. The token
-- is a fingerprint of exactly that set — the same dependency set T3 established
-- — so any change to any source invalidates a review.
create or replace function public.pricing_review_token(p_visit_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select md5(
    coalesce((select t.materials::text || '|' || t.processing_fee::text || '|' ||
                     t.other_deductions::text || '|' || t.advances::text || '|' ||
                     t.net::text || '|' || t.remaining_debt::text
                from public.settlement_totals(p_visit_id) t), '-')
    || '||' || coalesce((select string_agg(
          vm.id::text || ':' || coalesce(vm.material_type_id::text, '') || ':' ||
          coalesce(vm.weight_kg::text, '') || ':' || coalesce(vm.unit_price::text, '') || ':' ||
          coalesce(vm.purchase_amount::text, '') || ':' || coalesce(vm.settlement_status, ''),
          ',' order by vm.id)
        from public.visit_materials vm where vm.visit_id = p_visit_id), '-')
    || '||' || coalesce((select string_agg(
          uc.id::text || ':' || coalesce(uc.kind, '') || ':' || coalesce(uc.amount::text, '') || ':' ||
          coalesce(uc.carried::text, ''), ',' order by uc.id)
        from public.utility_charges uc where uc.visit_id = p_visit_id), '-')
    || '||' || coalesce((select string_agg(
          ad.id::text || ':' || coalesce(ad.amount::text, '') || ':' || coalesce(ad.kind, ''),
          ',' order by ad.id)
        from public.advance_deductions ad where ad.ref_visit_id = p_visit_id), '-')
    || '||' || coalesce((select v.state::text from public.visits v where v.id = p_visit_id), '-')
  );
$function$;

-- approve_pricing now requires the token. The single-argument version is
-- DROPPED, not left beside it: an overload that still approved without a token
-- would be the bypass this migration exists to close.
drop function if exists public.approve_pricing(uuid);

create or replace function public.approve_pricing(p_visit_id uuid, p_reviewed_token text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_state text; v_site uuid; t record; v_settle_id uuid; v_token text;
begin
  if not public.is_owner() then raise exception 'only the owner can approve pricing'; end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'awaiting_price_approval' then raise exception 'visit is not awaiting price approval'; end if;

  -- Locks first, in the order T3/0156 established: settlement, then the visit
  -- the source guards take, then the supplier whose debt this row freezes.
  select id into v_settle_id from public.batch_settlements
    where visit_id = p_visit_id and status <> 'paid'
    for update;
  if v_settle_id is not null
     and exists (select 1 from public.settlement_payments where settlement_id = v_settle_id) then
    raise exception 'Payments have already been recorded for this settlement.'
      using errcode = 'SP001';
  end if;

  perform 1 from public.visits where id = p_visit_id for update;
  perform 1 from public.suppliers
   where id = (select supplier_id from public.visits where id = p_visit_id)
   for share;

  -- Only now, with every source held still, is the reviewed version checked —
  -- so a refusal happens before the first write and leaves nothing behind.
  v_token := public.pricing_review_token(p_visit_id);
  if p_reviewed_token is null or p_reviewed_token <> v_token then
    raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
      using errcode = 'ST001';
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
end;
$function$;

revoke execute on function public.approve_pricing(uuid, text) from public, anon;
grant execute on function public.approve_pricing(uuid, text) to authenticated;
revoke execute on function public.pricing_review_token(uuid) from public, anon;
grant execute on function public.pricing_review_token(uuid) to authenticated;

-- ── Cost price: the reviewed version is the run and everything it consumes ──
-- 0160 (CP001-CP005) governs the run from approval onward; it says nothing
-- about the interval while a human is reading it. The token covers what the
-- owner is shown and what approval consumes: membership, each lot's weight,
-- cost and status, and the extras.
create or replace function public.cost_price_review_token(p_run_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select md5(
    coalesce((select coalesce(r.approval_status, '') || ':' || coalesce(r.material_type_id::text, '') || ':' ||
                     coalesce(r.total_weight_kg::text, '') || ':' || coalesce(r.total_cost_price::text, '') || ':' ||
                     coalesce(r.avg_cost_price_per_kg::text, '')
                from public.cost_price_runs r where r.id = p_run_id), '-')
    || '||' || coalesce((select string_agg(
          sl.id::text || ':' || coalesce(sl.weight_kg::text, '') || ':' ||
          coalesce(sl.cost_price_per_kg::text, '') || ':' || coalesce(sl.status, ''),
          ',' order by sl.id)
        from public.cost_price_run_lots l
        join public.stock_lots sl on sl.id = l.stock_lot_id
       where l.run_id = p_run_id), '-')
    || '||' || coalesce((select string_agg(
          x.id::text || ':' || coalesce(x.material_name, '') || ':' ||
          coalesce(x.weight_kg::text, '') || ':' || coalesce(x.cost_price_per_kg::text, ''),
          ',' order by x.id)
        from public.cost_price_run_extras x where x.run_id = p_run_id), '-')
  );
$function$;

-- The token is carried in a transaction-local setting, the same discipline
-- 0159 uses for visit transitions: approval is a table UPDATE here (0160 drives
-- everything from its triggers), so a parameter is not available and a direct
-- UPDATE must not be able to approve without naming what it reviewed.
create or replace function public._cost_price_stale_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if OLD.approval_status = 'pending' and NEW.approval_status = 'approved' then
    if coalesce(current_setting('app.cost_price_review', true), '')
       <> public.cost_price_review_token(OLD.id) then
      raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
        using errcode = 'ST001';
    end if;
  end if;
  return NEW;
end;
$function$;

-- 'aa' so this fires FIRST, ahead of 0160's own BEFORE trigger. That ordering is
-- required, not cosmetic: t_cost_price_runs_lifecycle locks the lots, releases
-- reservations and recomputes the run as part of approving it, so a guard
-- running after it would be fingerprinting a run 0160 had already begun to
-- change and would refuse every legitimate approval. Checking staleness first
-- also matches the rule the rest of this migration follows — the reviewed
-- version is proven before anything happens.
create trigger t_cost_price_runs_aa_stale_guard
  before update on public.cost_price_runs
  for each row execute function public._cost_price_stale_guard();

create or replace function public.approve_cost_price_run(
  p_run_id uuid, p_reviewed_token text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_token text;
begin
  if not public.is_owner() then
    raise exception 'only the owner approves a cost price run';
  end if;

  select * into r from public.cost_price_runs where id = p_run_id for update;
  if r.id is null then raise exception 'cost price run not found'; end if;
  if r.approval_status <> 'pending' then
    raise exception 'This cost price run has already been ruled on.' using errcode = 'ST001';
  end if;

  v_token := public.cost_price_review_token(p_run_id);
  if p_reviewed_token is null or p_reviewed_token <> v_token then
    raise exception 'This record changed after you opened it. Refresh and review it again before approving.'
      using errcode = 'ST001';
  end if;

  -- 0160's triggers do the whole approval: lot locking, CP002 revalidation,
  -- reservation release, totals recomputation and the sale itself.
  perform set_config('app.cost_price_review', v_token, true);
  update public.cost_price_runs
     set approval_status = 'approved', approved_by = auth.uid(), approved_at = now(),
         sold = true, sold_at = now()
   where id = p_run_id;
  perform set_config('app.cost_price_review', '', true);
end;
$function$;

revoke execute on function public.approve_cost_price_run(uuid, text) from public, anon;
revoke execute on function public.cost_price_review_token(uuid) from public, anon;
grant execute on function public.approve_cost_price_run(uuid, text) to authenticated;
grant execute on function public.cost_price_review_token(uuid) to authenticated;
