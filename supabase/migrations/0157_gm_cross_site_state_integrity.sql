-- ─── 0157: cross-site authority is not a state-machine bypass ───────────────
-- 0077 gave the general manager (the New-Site manager) cross-site writes by
-- adding a policy per table whose whole condition is `is_general_manager()`.
-- The site-manager policies those were meant to mirror also say WHEN a write is
-- allowed (visit still open, advance not paid, ...). The GM copies dropped that
-- half, so the GM alone could, locally reproduced in audit 3F (F-03):
--
--   * delete a PAID settlement (payments cascaded; 0156 now refuses that part);
--   * delete a PAID advance — supplier debt 50,000 -> 0;
--   * rewrite weight/price on a stocked, paid batch — line 100,000 -> 500,
--     lot and settlement left at the old figures;
--   * UPDATE a deduction past the supplier's debt — debt -899,000. The 0153
--     guard only runs on INSERT.
--
-- Business ruling 3F-T2: the GM keeps cross-site authority, and gets exactly
-- the state rules of the normal workflow for the same operation. The site term
-- is the only thing dropped. The owner is unchanged throughout.
--
-- Policy family review (23 GM policies on 8 tables):
--   visit_materials   I/U/D  no state            -> state added (this file)
--   pricing           I/U/D  no state            -> state added
--   utility_charges   I/U/D  no state            -> state added
--   batch_settlements D      no state            -> delete_batch's GM rule
--   advances          D      paid deletable      -> not paid
--   advance_deductions U     no debt guard       -> UPDATE guard trigger
--   unchanged:
--     batch_settlements I, advances I, advance_deductions I/D, consumables I/U,
--     gate_exit_authorizations I (site term only — the intended difference);
--     advances U, consumables U (their status triggers already enforce state);
--     batch_settlements U (status guarded by its transition trigger; the
--     financial columns are F-04, a later tranche);
--     gate_exit_authorizations U/D (no money or stock, no caller).
--
-- A third gap is not GM-specific. A line edit racing the payment that stocks the
-- batch still commits, reproduced for a site manager and the GM alike: lot
-- 1,000 kg, line 5 kg, settlement paid at the old total. Nothing serialises them.
-- The payment locks only the settlement row, and the line UPDATE never touches
-- it. §4 adds that serialisation for the lock-guarded roles.
--
-- Production when written: no negative supplier debt, no lot/line or
-- settlement/line mismatches. No row is rewritten here.

-- ── 0. Precondition: the policies are still exactly what was audited ────────
do $$
declare n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (
       ('visit_materials',   'visit_materials: general manager writes cross-site (insert)'),
       ('visit_materials',   'visit_materials: general manager writes cross-site (update)'),
       ('visit_materials',   'visit_materials: general manager writes cross-site (delete)'),
       ('pricing',           'pricing: general manager writes cross-site (insert)'),
       ('pricing',           'pricing: general manager writes cross-site (update)'),
       ('pricing',           'pricing: general manager writes cross-site (delete)'),
       ('utility_charges',   'utility_charges: general manager writes cross-site (insert)'),
       ('utility_charges',   'utility_charges: general manager writes cross-site (update)'),
       ('utility_charges',   'utility_charges: general manager writes cross-site (delete)'),
       ('batch_settlements', 'batch_settlements: general manager writes cross-site (delete)'),
       ('advances',          'advances: general manager writes cross-site (delete)'))
     and coalesce(qual, 'is_general_manager()') = 'is_general_manager()'
     and coalesce(with_check, 'is_general_manager()') = 'is_general_manager()';
  if n <> 11 then
    raise exception '0157 precondition failed: expected the 11 audited 0077 GM policies unchanged, found %', n;
  end if;
end $$;

-- ── 1. Material lines: the states the normal workflow writes them in ─────────
-- Insert: processing (in_processing), receiving (in_receiving), a manager adding
-- a missing line (pricing). Delete: processing / receiving drafts. Update: the
-- manager's correction rule — while the visit is open.
alter policy "visit_materials: general manager writes cross-site (insert)" on public.visit_materials
  with check (public.is_general_manager() and exists (
    select 1 from public.visits v
     where v.id = visit_materials.visit_id
       and v.state in ('in_processing', 'in_receiving', 'pricing')));

alter policy "visit_materials: general manager writes cross-site (update)" on public.visit_materials
  using (public.is_general_manager() and public.visit_is_open(visit_id))
  with check (public.is_general_manager() and public.visit_is_open(visit_id));

alter policy "visit_materials: general manager writes cross-site (delete)" on public.visit_materials
  using (public.is_general_manager() and exists (
    select 1 from public.visits v
     where v.id = visit_materials.visit_id
       and v.state in ('in_processing', 'in_receiving')));

-- ── 2. Pricing and utility charges: while the visit is open ──────────────────
alter policy "pricing: general manager writes cross-site (insert)" on public.pricing
  with check (public.is_general_manager() and exists (
    select 1 from public.visits v where v.id = pricing.visit_id and v.state = 'pricing'));

alter policy "pricing: general manager writes cross-site (update)" on public.pricing
  using (public.is_general_manager() and public.visit_is_open(visit_id))
  with check (public.is_general_manager() and public.visit_is_open(visit_id));

-- No site role deletes pricing directly; the GM policy is narrowed, not removed.
alter policy "pricing: general manager writes cross-site (delete)" on public.pricing
  using (public.is_general_manager() and public.visit_is_open(visit_id));

alter policy "utility_charges: general manager writes cross-site (insert)" on public.utility_charges
  with check (public.is_general_manager() and public.visit_is_open(visit_id));

alter policy "utility_charges: general manager writes cross-site (update)" on public.utility_charges
  using (public.is_general_manager() and public.visit_is_open(visit_id))
  with check (public.is_general_manager() and public.visit_is_open(visit_id));

alter policy "utility_charges: general manager writes cross-site (delete)" on public.utility_charges
  using (public.is_general_manager() and public.visit_is_open(visit_id));

-- ── 3. Settlements and advances: the terminal states stay terminal ───────────
-- delete_batch lets the GM remove a batch until the owner has approved it; the
-- direct delete gets the same line. 'paid' is refused by STATUS here, which is
-- what protects the 48 legacy paid settlements that have no payment rows; 0156
-- still refuses any settlement with payment rows.
alter policy "batch_settlements: general manager writes cross-site (delete)" on public.batch_settlements
  using (public.is_general_manager() and status not in ('approved', 'paid'));

alter policy "advances: general manager writes cross-site (delete)" on public.advances
  using (public.is_general_manager() and approval_status <> 'paid');

-- ── 4. A line edit cannot race the payment that stocks its batch ─────────────
-- record_settlement_payment (0151) locks the settlement row, writes the stock
-- lots from the lines, and marks the visit stocked. A line UPDATE takes no lock
-- that conflicts with any of that, so RLS saw the visit "open" and let a new
-- weight commit beside a lot written from the old one.
--
-- For the roles the lock rules bind (everyone but the owner and trusted internal
-- calls), a change to quantity, price or material now takes a SHARE lock on the
-- settlement. The payment path waits for that lock, or this edit finds the payment
-- already holding it, and re-checks the batch afterwards. NOWAIT: a waiting lock
-- here could deadlock with approve_pricing / send-back, which lock the settlement
-- and then the lines. Refusing instead leaves the operator a retry.
create or replace function public._visit_materials_finalised_lock()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.weight_kg is not distinct from OLD.weight_kg
     and NEW.unit_price is not distinct from OLD.unit_price
     and NEW.material_type_id is not distinct from OLD.material_type_id then
    return NEW;
  end if;
  if auth.uid() is null or public.is_owner() then
    return NEW;
  end if;

  begin
    perform 1 from public.batch_settlements where visit_id = NEW.visit_id for share nowait;
  exception when lock_not_available then
    raise exception 'This batch is being settled right now — try again in a moment.'
      using errcode = 'VM002';
  end;

  if not public.visit_is_open(NEW.visit_id)
     or exists (select 1 from public.batch_settlements
                 where visit_id = NEW.visit_id and status = 'paid') then
    raise exception 'This material line is locked — its batch has been finalised.'
      using errcode = 'VM001';
  end if;
  return NEW;
end; $$;

create trigger t_visit_materials_finalised_lock
  before update on public.visit_materials
  for each row execute function public._visit_materials_finalised_lock();

-- ── 5. Deduction UPDATE honours the outstanding-debt guard ──────────────────
-- The 0153 guard (_advance_deductions_guard) is BEFORE INSERT only. On UPDATE the
-- debt figure still includes this row's OLD amount, so the room available to the
-- new amount is outstanding + OLD.amount when the row stays on the same supplier
-- and balance kind. A decrease is always allowed. The same supplier lock as the
-- insert guard serialises concurrent edits (both suppliers, in id order, when a
-- row is moved).
create or replace function public._advance_deductions_update_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare outstanding numeric; same_balance boolean;
begin
  if NEW.amount is not distinct from OLD.amount
     and NEW.supplier_id is not distinct from OLD.supplier_id
     and NEW.kind is not distinct from OLD.kind then
    return NEW;
  end if;

  perform 1 from public.suppliers
   where id in (OLD.supplier_id, NEW.supplier_id)
   order by id
   for update;

  same_balance := NEW.supplier_id = OLD.supplier_id and NEW.kind = OLD.kind;
  if same_balance and NEW.amount <= OLD.amount then
    return NEW;
  end if;

  if NEW.kind = 'processing' then
    outstanding := public.supplier_processing_debt(NEW.supplier_id);
  else
    outstanding := public.supplier_outstanding_debt(NEW.supplier_id);
  end if;
  if same_balance then
    outstanding := outstanding + OLD.amount;
  end if;

  if NEW.amount > outstanding then
    raise exception 'deduction % exceeds outstanding debt % (%)', NEW.amount, outstanding, NEW.kind
      using errcode = '23514';
  end if;
  return NEW;
end; $$;

create trigger t_advance_deductions_update_guard
  before update on public.advance_deductions
  for each row execute function public._advance_deductions_update_guard();
