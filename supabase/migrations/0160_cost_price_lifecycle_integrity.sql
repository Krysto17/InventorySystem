-- 0160 — Cost-price run lifecycle integrity (Phase 3F-T5: F-06, F-15)
--
-- A cost-price run is a draft until the owner approves it, and approval is the
-- sale: every attached lot flips to `sold` and leaves stock ('mixed_batch' out).
-- After that the run is the historical record of what was sold and at what
-- weighted cost.
--
-- F-06. Approval only ever locked DELETE (RLS "... unapproved"). Nothing stopped
-- a stale editor, the general manager or the service role from INSERTING an extra
-- or a lot into an approved run — the recompute trigger then rewrote the run's
-- totals, and an attached lot stayed `available` inside a "sold" run. The extras
-- UPDATE policy checks the status of the run a row came FROM, never the run it is
-- moved TO, so an extra could be re-pointed into an approved run. The owner's
-- UPDATE policy on runs has no state predicate at all (totals overwritten,
-- approved -> rejected with the lots still sold), the owner's UPDATE policy on
-- stock_lots can put a sold lot back to `available` or change its weight/cost,
-- and any author could INSERT a run already marked approved.
--
-- F-15. A pending run keeps no claim on its lots. The same lot could sit in two
-- pending runs, a sold lot could be attached to a new one, and when a lot left
-- stock (another run approved, a gate release) the draft kept it and kept
-- counting it, with approval failing on a message naming the lot's id.
--
-- Rulings implemented here:
--
--   APPROVED is immutable (CP001) for every caller — owner, general manager,
--   inventory, service role — and for trusted code: the run row itself, its lot
--   membership, its extras (insert, update, delete, re-pointing), deleting it,
--   and the lot fields its figures came from (weight, cost, site, material, and
--   `sold` status). There is no bypass; an approved calculation that was wrong is
--   a future correction workflow, not an edit.
--
--   APPROVAL happens once, from `pending` only (CP004, also refusing a run that is
--   born approved or marked sold), and needs at least one stock lot (CP005 — the
--   app's existing "a sale needs a stocked lot" rule). Before the row is written the run's buckets
--   and lots are locked in the 0153 order (bucket -> lot, both ordered), every lot
--   must still be `available` (CP002) and not on a live gate pass (GP007, 0155),
--   and the totals are recomputed from those locked rows and the run's extras.
--   Any refusal aborts the whole statement: the run stays pending and no lot, no
--   movement and no child row changes.
--
--   A LOT is eligible for a draft while it is `available` and not on a live gate
--   pass (CP002 at attach time). While a run is `pending` its lots are RESERVED:
--   the same lot cannot be attached to a second pending run, and a run cannot be
--   put back to pending while one of its lots is reserved elsewhere (CP003). A
--   saved computation (no status) or a rejected run reserves nothing.
--
--   A DRAFT whose lot leaves stock anyway (a gate release, or a legacy overlap
--   approved elsewhere) keeps the membership. It is NOT removed automatically:
--   that would silently change the draft's totals and erase what the operator
--   selected, and removing it from the release/approval paths would take the run
--   lock after the lot lock — the inverse of every other path here. The stale lot
--   is derivable (its status), the screens show it, removing it is the existing
--   "Remove" action, and approval refuses until it is gone.
--
-- Lock order, all paths: run row -> reservation lock -> buckets -> lots.
--   * child writes lock the run row (FOR NO KEY UPDATE — the same lock the
--     recompute UPDATE takes, so two writers to one run cannot deadlock upgrading
--     a share lock), then the reservation lock, then the lot FOR SHARE;
--   * approval holds the run row (it is the row being updated), then buckets, then
--     lots FOR UPDATE — and never the reservation lock;
--   * gate acknowledgement is pass -> bucket -> lot (0155); gate issue is lot only.
--
-- No policy or grant changes. Historical rows are not rewritten or re-validated:
-- production had 0 approved-run drift when this was written, and the one stale
-- pending run (27 lots sold through a later approved run) is left for business
-- handling.

-- ── Runs ─────────────────────────────────────────────────────────────────────
create or replace function public._cost_price_runs_lifecycle()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  bucket record;
  it     record;
  lot    record;
  tot_w  numeric;
  tot_c  numeric;
begin
  if TG_OP = 'DELETE' then
    if OLD.approval_status = 'approved' then
      raise exception 'Approved cost price runs cannot be changed.' using errcode = 'CP001';
    end if;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.approval_status = 'approved' or NEW.sold then
      raise exception 'Only a batch awaiting approval can be approved.' using errcode = 'CP004';
    end if;
    return NEW;
  end if;

  -- UPDATE
  if OLD.approval_status = 'approved' then
    if row(NEW.*) is distinct from row(OLD.*) then
      raise exception 'Approved cost price runs cannot be changed.' using errcode = 'CP001';
    end if;
    return NEW;
  end if;

  if NEW.approval_status is distinct from 'approved' then
    if NEW.sold then
      raise exception 'Only a batch awaiting approval can be approved.' using errcode = 'CP004';
    end if;
    -- Back to pending: its lots become reserved again, so none may be reserved
    -- by another pending run.
    if NEW.approval_status = 'pending' and OLD.approval_status is distinct from 'pending' then
      perform pg_advisory_xact_lock(hashtextextended('cost_price_lot_reservation', 0));
      if exists (
        select 1
          from public.cost_price_run_lots mine
          join public.cost_price_run_lots other on other.stock_lot_id = mine.stock_lot_id
                                               and other.run_id <> mine.run_id
          join public.cost_price_runs r on r.id = other.run_id
         where mine.run_id = NEW.id and r.approval_status = 'pending'
      ) then
        raise exception 'That lot is already in another batch awaiting approval.' using errcode = 'CP003';
      end if;
    end if;
    return NEW;
  end if;

  -- pending -> approved: the one approval.
  if OLD.approval_status is distinct from 'pending' then
    raise exception 'Only a batch awaiting approval can be approved.' using errcode = 'CP004';
  end if;

  -- Approval is a sale of stock. The app has always refused to submit a batch
  -- with no stocked lot; a draft whose lots were all removed must not be approved
  -- as a sale of nothing.
  if not exists (select 1 from public.cost_price_run_lots where run_id = NEW.id) then
    raise exception 'A batch needs at least one stock lot before it can be approved.' using errcode = 'CP005';
  end if;

  -- Buckets first, ordered (0153), then lots, ordered.
  for bucket in
    select distinct l.site_id, l.material_type_id
      from public.cost_price_run_lots rl
      join public.stock_lots l on l.id = rl.stock_lot_id
     where rl.run_id = NEW.id
     order by l.site_id, l.material_type_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(bucket.site_id::text || bucket.material_type_id::text || '', 0));
  end loop;

  tot_w := 0; tot_c := 0;
  for it in select stock_lot_id from public.cost_price_run_lots
             where run_id = NEW.id order by stock_lot_id loop
    select * into lot from public.stock_lots where id = it.stock_lot_id for update;
    if lot.id is null or lot.status <> 'available' then
      raise exception 'One or more selected lots are no longer available. Refresh the run before approving it.'
        using errcode = 'CP002';
    end if;
    if exists (select 1 from public.gate_passes
                where stock_lot_id = lot.id and status in ('pending', 'issued', 'acknowledged')) then
      raise exception 'Lot is on a live gate pass — cancel the pass first.' using errcode = 'GP007';
    end if;
    tot_w := tot_w + lot.weight_kg;
    tot_c := tot_c + lot.weight_kg * coalesce(lot.cost_price_per_kg, 0);
  end loop;

  -- Extras cannot move under us: every extra write locks this run row first.
  select tot_w + coalesce(sum(e.weight_kg), 0),
         tot_c + coalesce(sum(e.weight_kg * coalesce(e.cost_price_per_kg, 0)), 0)
    into tot_w, tot_c
    from public.cost_price_run_extras e where e.run_id = NEW.id;

  -- The approved snapshot is what the locked rows say now, whatever the draft
  -- last stored.
  NEW.total_weight_kg       := tot_w;
  NEW.total_cost_price      := tot_c;
  NEW.avg_cost_price_per_kg := case when tot_w > 0 then round(tot_c / tot_w, 2) else null end;
  NEW.sold        := true;
  NEW.sold_at     := coalesce(NEW.sold_at, now());
  NEW.approved_at := coalesce(NEW.approved_at, now());
  NEW.approved_by := coalesce(NEW.approved_by, auth.uid());
  return NEW;
end;
$function$;

create trigger t_cost_price_runs_lifecycle
  before insert or update or delete on public.cost_price_runs
  for each row execute function public._cost_price_runs_lifecycle();

-- ── Run children ─────────────────────────────────────────────────────────────
-- Locks the run(s) a child row belongs to — ordered, so re-pointing a row between
-- two runs cannot deadlock against the reverse move — and refuses if either is
-- approved. A run that no longer exists is a cascade from its own (unapproved)
-- delete, and is allowed.
create or replace function public._cost_price_lock_unapproved_runs(p_a uuid, p_b uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record;
begin
  for r in
    select id, approval_status from public.cost_price_runs
     where id in (p_a, p_b) order by id
       for no key update
  loop
    if r.approval_status = 'approved' then
      raise exception 'Approved cost price runs cannot be changed.' using errcode = 'CP001';
    end if;
  end loop;
end;
$function$;

-- Trigger plumbing, not an API: nobody may call it through PostgREST (0152).
revoke execute on function public._cost_price_lock_unapproved_runs(uuid, uuid) from public, anon, authenticated;

create or replace function public._cost_price_run_extras_lifecycle()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if TG_OP = 'INSERT' then
    perform public._cost_price_lock_unapproved_runs(NEW.run_id, NEW.run_id);
    return NEW;
  elsif TG_OP = 'UPDATE' then
    perform public._cost_price_lock_unapproved_runs(OLD.run_id, NEW.run_id);
    return NEW;
  end if;
  perform public._cost_price_lock_unapproved_runs(OLD.run_id, OLD.run_id);
  return OLD;
end;
$function$;

create trigger t_cost_price_run_extras_lifecycle
  before insert or update or delete on public.cost_price_run_extras
  for each row execute function public._cost_price_run_extras_lifecycle();

create or replace function public._cost_price_run_lots_lifecycle()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  lot record;
begin
  if TG_OP = 'DELETE' then
    -- Removing a lot from a draft is always allowed: it is how a stale draft is
    -- repaired.
    perform public._cost_price_lock_unapproved_runs(OLD.run_id, OLD.run_id);
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    perform public._cost_price_lock_unapproved_runs(OLD.run_id, NEW.run_id);
    if NEW.run_id = OLD.run_id and NEW.stock_lot_id = OLD.stock_lot_id then
      return NEW;
    end if;
  else
    perform public._cost_price_lock_unapproved_runs(NEW.run_id, NEW.run_id);
  end if;

  select approval_status into v_status from public.cost_price_runs where id = NEW.run_id;
  if v_status = 'pending' then
    perform pg_advisory_xact_lock(hashtextextended('cost_price_lot_reservation', 0));
  end if;

  select * into lot from public.stock_lots where id = NEW.stock_lot_id for share;
  if lot.id is null or lot.status <> 'available'
     or exists (select 1 from public.gate_passes
                 where stock_lot_id = lot.id and status in ('pending', 'issued', 'acknowledged')) then
    raise exception 'One or more selected lots are no longer available. Refresh the run before approving it.'
      using errcode = 'CP002';
  end if;

  if v_status = 'pending' and exists (
    select 1 from public.cost_price_run_lots x
      join public.cost_price_runs r on r.id = x.run_id
     where x.stock_lot_id = NEW.stock_lot_id
       and x.run_id <> NEW.run_id
       and r.approval_status = 'pending'
  ) then
    raise exception 'That lot is already in another batch awaiting approval.' using errcode = 'CP003';
  end if;

  return NEW;
end;
$function$;

create trigger t_cost_price_run_lots_lifecycle
  before insert or update or delete on public.cost_price_run_lots
  for each row execute function public._cost_price_run_lots_lifecycle();

-- ── Source lots of an approved run ───────────────────────────────────────────
-- The figures an approved run was computed from stay what they were. The sale
-- itself (available -> sold, inside approval) is the one status change allowed;
-- nothing may take a sold lot of an approved run back out of `sold`. Fields the
-- calculation never read (batch_paid, supplier_id) are untouched.
create or replace function public._stock_lots_approved_run_freeze()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (NEW.weight_kg         is distinct from OLD.weight_kg
      or NEW.cost_price_per_kg is distinct from OLD.cost_price_per_kg
      or NEW.site_id           is distinct from OLD.site_id
      or NEW.material_type_id  is distinct from OLD.material_type_id
      or (OLD.status = 'sold' and NEW.status is distinct from 'sold'))
     and exists (select 1 from public.cost_price_run_lots x
                   join public.cost_price_runs r on r.id = x.run_id
                  where x.stock_lot_id = OLD.id and r.approval_status = 'approved') then
    raise exception 'Approved cost price runs cannot be changed.' using errcode = 'CP001';
  end if;
  return NEW;
end;
$function$;

create trigger t_stock_lots_approved_run_freeze
  before update on public.stock_lots
  for each row execute function public._stock_lots_approved_run_freeze();
