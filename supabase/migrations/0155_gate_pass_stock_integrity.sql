-- ─── 0155: a lot-linked gate pass releases its lot once, and only once ──────
-- Audit 3E-7A proved (locally, with identical production function/policy
-- hashes) that nothing on the lot-linked gate-pass path checked, locked or
-- updated the stock lot:
--   • two live passes could be issued for one lot, even concurrently;
--   • acknowledging a pass wrote a 'gate_release' out for the PASS weight
--     (editable, unbounded: 50 kg left a 10 kg lot) and never touched the lot,
--     so the lot stayed 'available' — sellable, re-passable, still valued;
--   • a lot sold through cost price could still be released at the gate, and a
--     released lot could still be sold: two deductions either way round;
--   • the gate's UPDATE rights let it self-authorise a pending pass (the
--     pending → issued branch trusted authorize_gate_pass() had been used) and
--     edit weight_kg / stock_lot_id before acknowledging.
--
-- Business rulings (3E-7B): a lot-linked pass is a NON-SALE release from stock.
-- Acknowledging it writes exactly one out movement for the LOT's weight and
-- turns the lot 'released' (the status 0122 introduced for material that went
-- back out), atomically. A lot on a live pass cannot be sold; a sold lot cannot
-- be put on a pass — sold material leaves on a free-text / supplier pass.
--
-- DEPLOYMENT PRECONDITION: production had one ISSUED pass on a lot that was
-- already SOLD. It must be cancelled first; precondition 4 below refuses to
-- run while it is live. That is deliberate — do not weaken it.
--
-- Refusals carry their own SQLSTATE (GP001–GP009) so the application can give
-- an operator a sentence without echoing database text.

-- ── 0. Preconditions: refuse to run on data the new rules would contradict ──
do $$
declare n integer;
begin
  select count(*) into n from (
    select stock_lot_id from public.gate_passes
     where stock_lot_id is not null and status in ('pending', 'issued', 'acknowledged')
     group by stock_lot_id having count(*) > 1) d;
  if n > 0 then
    raise exception '0155 precondition 1 failed: % stock lot(s) have more than one live gate pass', n;
  end if;

  select count(*) into n from public.gate_passes g join public.stock_lots l on l.id = g.stock_lot_id
   where g.status in ('pending', 'issued', 'acknowledged') and g.site_id <> l.site_id;
  if n > 0 then
    raise exception '0155 precondition 2 failed: % live lot-linked gate pass(es) are on a different site from their lot', n;
  end if;

  select count(*) into n from public.gate_passes g join public.stock_lots l on l.id = g.stock_lot_id
   where g.status in ('pending', 'issued', 'acknowledged') and g.weight_kg is distinct from l.weight_kg;
  if n > 0 then
    raise exception '0155 precondition 3 failed: % live lot-linked gate pass(es) carry a weight different from their lot', n;
  end if;

  select count(*) into n from public.gate_passes g join public.stock_lots l on l.id = g.stock_lot_id
   where g.status in ('pending', 'issued') and l.status <> 'available';
  if n > 0 then
    raise exception '0155 precondition 4 failed: % live lot-linked gate pass(es) point at a lot that is no longer available — cancel them first', n;
  end if;

  select count(*) into n from public.gate_passes g join public.stock_lots l on l.id = g.stock_lot_id
   where g.status in ('pending', 'issued', 'acknowledged')
     and g.material_type_id is not null and g.material_type_id <> l.material_type_id;
  if n > 0 then
    raise exception '0155 precondition 5 failed: % live lot-linked gate pass(es) name a different material from their lot', n;
  end if;

  select count(*) into n from public.gate_passes g join public.stock_lots l on l.id = g.stock_lot_id
   where g.status = 'acknowledged' and l.status <> 'released';
  if n > 0 then
    raise exception '0155 precondition 6 failed: % acknowledged lot-linked gate pass(es) left their lot not released — reconcile first', n;
  end if;
end $$;

-- ── 1. Trace a gate release back to the pass that caused it ─────────────────
-- Historical releases (written directly by 0122) keep gate_pass_id null; no
-- link is invented for them.
alter table public.stock_movements
  add column gate_pass_id uuid references public.gate_passes(id);

-- One release per pass, by schema — not merely by the trigger's no-op rule.
create unique index stock_movements_one_release_per_gate_pass
  on public.stock_movements (gate_pass_id)
  where gate_pass_id is not null and reason = 'gate_release';

-- ── 2. One live pass per lot ────────────────────────────────────────────────
-- 'acknowledged' stays in the set for good: that lot has left stock. Only a
-- cancelled pass frees the lot for a reissue or a sale.
create unique index gate_passes_one_live_pass_per_lot
  on public.gate_passes (stock_lot_id)
  where stock_lot_id is not null and status in ('pending', 'issued', 'acknowledged');

-- ── 3. Insert guard ─────────────────────────────────────────────────────────
-- Applies to every insert path (app, direct API, owner, GM, receiving). It locks
-- only the lot — never a stock bucket — so it cannot invert the bucket → lot
-- order that cost-price approval and gate acknowledgement both take.
create or replace function public._gate_passes_before_insert()
  returns trigger language plpgsql security definer set search_path = public as $$
declare lot record;
begin
  -- Passes start as a request or an issued pass. Nothing is born acknowledged
  -- (that would skip the release) or cancelled.
  if NEW.status not in ('pending', 'issued') then
    raise exception 'A gate pass can only be raised as a request or issued.' using errcode = 'GP008';
  end if;

  if NEW.stock_lot_id is not null then
    select * into lot from public.stock_lots where id = NEW.stock_lot_id for update;
    if lot.id is null or lot.status <> 'available' then
      raise exception 'That stock lot is no longer available.' using errcode = 'GP001';
    end if;
    if lot.site_id <> NEW.site_id then
      raise exception 'That stock lot is on another site.' using errcode = 'GP002';
    end if;
    if NEW.material_type_id is not null and NEW.material_type_id <> lot.material_type_id then
      raise exception 'That stock lot is a different material.' using errcode = 'GP003';
    end if;
    -- The pass releases the whole lot. Whatever weight the caller sent is
    -- replaced, never merely bounded.
    NEW.material_type_id := lot.material_type_id;
    NEW.weight_kg := lot.weight_kg;
  end if;
  return NEW;
end; $$;

create trigger t_gate_passes_lot_guard
  before insert on public.gate_passes
  for each row execute function public._gate_passes_before_insert();

-- ── 4. Transitions: frozen identity, real authorisation, atomic release ─────
create or replace function public._gate_passes_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  lot    record;
  v_site uuid;
  v_mat  uuid;
begin
  -- A pass is what it was issued as. The gate's UPDATE rights exist to
  -- acknowledge; they must not re-point the lot or change the weight first.
  if NEW.stock_lot_id     is distinct from OLD.stock_lot_id
     or NEW.weight_kg        is distinct from OLD.weight_kg
     or NEW.site_id          is distinct from OLD.site_id
     or NEW.material_type_id is distinct from OLD.material_type_id then
    raise exception 'A gate pass''s lot, weight, site and material cannot be changed.' using errcode = 'GP004';
  end if;

  if NEW.status = OLD.status then return NEW; end if;

  if OLD.status = 'pending' and NEW.status = 'issued' then
    -- Same rule as authorize_gate_pass(). Before 0155 this branch trusted that
    -- the RPC had been used, so the gate could issue a request by UPDATE.
    if auth.uid() is not null and not coalesce((public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and OLD.site_id = public.current_site())), false) then
      raise exception 'Only a manager or the owner can authorise a gate pass.' using errcode = 'GP005';
    end if;
    -- The lot may have changed while the request waited.
    if NEW.stock_lot_id is not null then
      select * into lot from public.stock_lots where id = NEW.stock_lot_id for update;
      if lot.id is null or lot.status <> 'available' then
        raise exception 'That stock lot is no longer available.' using errcode = 'GP001';
      end if;
      if lot.site_id <> NEW.site_id then
        raise exception 'That stock lot is on another site.' using errcode = 'GP002';
      end if;
    end if;

  elsif OLD.status = 'pending' and NEW.status = 'cancelled' then
    if auth.uid() is not null
       and not (public.is_owner() or public.current_role() in ('manager', 'receiving')) then
      raise exception 'only the manager, owner or the raising clerk can drop a request';
    end if;

  elsif OLD.status = 'issued' and NEW.status = 'acknowledged' then
    if auth.uid() is not null and public.current_role() <> 'gate' then
      raise exception 'only the gate can acknowledge a gate pass';
    end if;
    NEW.acknowledged_by := coalesce(NEW.acknowledged_by, auth.uid());
    NEW.acknowledged_at := coalesce(NEW.acknowledged_at, now());

    if NEW.stock_lot_id is not null then
      -- LOCK ORDER: bucket first, then the lot — the order cost-price approval
      -- takes (0153). Locking the lot first and letting the movement insert take
      -- the bucket would be lot → bucket, the deadlock resolved in 3E-5B.
      select site_id, material_type_id into v_site, v_mat
        from public.stock_lots where id = NEW.stock_lot_id;
      if v_site is null then
        raise exception 'This lot is no longer available for release.' using errcode = 'GP006';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_site::text || v_mat::text || '', 0));

      select * into lot from public.stock_lots where id = NEW.stock_lot_id for update;
      if lot.status <> 'available' then
        raise exception 'This lot is no longer available for release.' using errcode = 'GP006';
      end if;
      if lot.site_id <> v_site or lot.material_type_id <> v_mat
         or lot.site_id <> NEW.site_id
         or (NEW.material_type_id is not null and NEW.material_type_id <> lot.material_type_id) then
        raise exception 'This gate pass no longer matches its stock lot.' using errcode = 'GP009';
      end if;

      -- Exactly the lot, exactly once: the lot's own weight (never the pass's),
      -- traced to this pass, and the lot leaves stock in the same transaction.
      insert into public.stock_movements (
        site_id, material_type_id, grade, weight, direction, recorded_by, reason, gate_pass_id
      ) values (
        lot.site_id, lot.material_type_id, null, lot.weight_kg, 'out',
        coalesce(auth.uid(), NEW.issued_by), 'gate_release', NEW.id
      );
      update public.stock_lots set status = 'released' where id = lot.id;
    end if;

  elsif OLD.status = 'issued' and NEW.status = 'cancelled' then
    if auth.uid() is not null and not (public.is_owner() or public.current_role() = 'manager') then
      raise exception 'only a manager or owner can cancel a gate pass';
    end if;

  else
    raise exception 'illegal gate pass transition: % → %', OLD.status, NEW.status
      using errcode = '22000';
  end if;

  return NEW;
end; $$;

-- ── 5. Sale guard: a lot on a live pass is being released, not sold ─────────
-- Identical to 0153's body except for the live-pass check, which runs after
-- the lot lock this function already takes — the bucket → lot order is kept.
create or replace function public._cost_price_runs_approve()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  it  record;
  lot record;
  bucket record;
begin
  if NEW.approval_status = 'approved' and OLD.approval_status is distinct from 'approved' then
    -- Take every stock bucket this run will consume BEFORE the first lot lock.
    --
    -- The balance guard on stock_movements takes an advisory lock per
    -- (site, material, grade). Acquiring it mid-loop meant this function held
    -- bucket while reaching for the next lot, whereas a second approval held
    -- that lot while reaching for the bucket — a reproducible deadlock. Taking
    -- the buckets first makes the order globally bucket -> lot; since 0155 gate
    -- acknowledgement takes the same order, so no path can invert it.
    --
    -- A run is NOT one bucket: 15 of 32 production runs span two sites. They
    -- are therefore ordered, so two runs over the same pair cannot take them in
    -- opposite orders. `grade` is '' because the inserts below always write null.
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

    -- Ordered too: two runs sharing lots must take them the same way round.
    for it in select stock_lot_id from public.cost_price_run_lots
               where run_id = NEW.id order by stock_lot_id loop
      select * into lot from public.stock_lots where id = it.stock_lot_id for update;
      if lot.id is null then
        raise exception 'stock lot % not found', it.stock_lot_id;
      end if;
      if lot.status <> 'available' then
        raise exception 'stock lot % already left stock (sold elsewhere)', it.stock_lot_id;
      end if;
      if exists (select 1 from public.gate_passes
                  where stock_lot_id = lot.id and status in ('pending', 'issued', 'acknowledged')) then
        raise exception 'Lot is on a live gate pass — cancel the pass first.' using errcode = 'GP007';
      end if;
      update public.stock_lots set status = 'sold' where id = lot.id;
      insert into public.stock_movements (
        site_id, material_type_id, grade, weight, direction, recorded_by, reason
      ) values (
        lot.site_id, lot.material_type_id, null, lot.weight_kg, 'out',
        coalesce(NEW.approved_by, auth.uid()), 'mixed_batch'
      );
    end loop;
  end if;
  return NEW;
end; $$;
