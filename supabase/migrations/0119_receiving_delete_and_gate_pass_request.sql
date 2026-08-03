-- ─── Receiving deletes a whole visit; receiving requests a gate pass ─────────
-- 1. Receiving may remove an entire visit they created, not only while it sits
--    in their own stage — a mistaken batch is often spotted after it has moved
--    on. The hard limits stay: nothing with a settlement, and nothing already
--    stocked or exited (money or stock has moved).
-- 2. Receiving can raise a gate pass for material leaving the yard, but it is
--    only valid once the MANAGER authorises it. A pass starts 'pending' and
--    becomes 'issued' on authorisation.

-- ── 1. Wider delete window for receiving ────────────────────────────────────
create or replace function public.delete_batch(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_settle_status text; v_state text; v_site uuid; v_role text;
begin
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;

  select status into v_settle_status
    from public.batch_settlements where visit_id = p_visit_id;
  v_role := public.current_role();

  if public.is_owner() then
    if v_settle_status = 'paid' then
      raise exception 'cannot delete a batch that has been paid';
    end if;
  elsif public.is_general_manager() then
    if v_settle_status in ('approved', 'paid') then
      raise exception 'cannot delete a batch the owner has already approved';
    end if;
  elsif v_role = 'processing' and v_site = public.current_site() then
    if v_state <> 'in_processing' then
      raise exception 'processing can only delete a visit still in processing';
    end if;
  elsif v_role = 'receiving' and v_site = public.current_site() then
    -- Receiving may remove the whole visit until money or stock is involved.
    if v_settle_status is not null then
      raise exception 'this batch already has a settlement — ask the manager to remove it';
    end if;
    if v_state in ('stocked', 'exited') then
      raise exception 'cannot delete a batch that is already %', v_state;
    end if;
  else
    raise exception 'not authorized to delete batches';
  end if;

  delete from public.visits where id = p_visit_id;
end; $$;

-- ── 2. Gate passes: receiving raises, manager authorises ────────────────────
alter table public.gate_passes drop constraint if exists gate_passes_status_check;
alter table public.gate_passes add constraint gate_passes_status_check
  check (status in ('pending', 'issued', 'acknowledged', 'cancelled'));

alter table public.gate_passes
  add column if not exists requested_by   uuid references public.profiles(id),
  add column if not exists authorized_by  uuid references public.profiles(id),
  add column if not exists authorized_at  timestamptz;

-- Receiving raises a pass on their own site; it must start unauthorised.
drop policy if exists "gate_passes: receiving requests own site" on public.gate_passes;
create policy "gate_passes: receiving requests own site"
  on public.gate_passes for insert to authenticated
  with check (
    public.current_role() = 'receiving'
    and site_id = public.current_site()
    and status = 'pending'
  );

-- Reading was limited to the gate role and cross-site readers, so the receiving
-- clerk couldn't see the pass they just raised and a SITE manager couldn't see
-- one to authorise it. Both need their own site's passes.
drop policy if exists "gate_passes: gate own-site or cross-site reader" on public.gate_passes;
drop policy if exists "gate_passes: own-site roles or cross-site reader" on public.gate_passes;
create policy "gate_passes: own-site roles or cross-site reader"
  on public.gate_passes for select to authenticated
  using (
    (public.current_role() in ('gate', 'receiving', 'manager') and site_id = public.current_site())
    or public.has_cross_site_read()
  );

-- The transition guard predates 'pending', so teach it the two new edges:
-- authorising a request (pending → issued) and dropping one (pending →
-- cancelled). Everything else is left exactly as it was.
create or replace function public._gate_passes_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  lot record;
  out_weight numeric(12,3);
begin
  if NEW.status = OLD.status then return NEW; end if;

  if OLD.status = 'pending' and NEW.status = 'issued' then
    -- Authorisation is done through authorize_gate_pass(), which checks the
    -- role and site and stamps who signed it off.
    null;

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

    -- Material tied to a stock lot leaves stock on acknowledgement.
    if NEW.stock_lot_id is not null then
      select * into lot from public.stock_lots where id = NEW.stock_lot_id;
      if lot.id is not null then
        out_weight := coalesce(NEW.weight_kg, lot.weight_kg);
        insert into public.stock_movements (
          site_id, material_type_id, grade, weight, direction, recorded_by, reason
        ) values (
          lot.site_id, lot.material_type_id, null, out_weight, 'out',
          coalesce(auth.uid(), NEW.issued_by), 'gate_release'
        );
      end if;
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

-- A pending pass carries no authority until the manager signs it off.
create or replace function public.authorize_gate_pass(p_pass_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_status text;
begin
  select site_id, status into v_site, v_status from public.gate_passes where id = p_pass_id;
  if v_site is null then raise exception 'gate pass not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'only the manager or owner can authorize a gate pass';
  end if;
  if v_status <> 'pending' then
    raise exception 'only a pending gate pass can be authorized (status: %)', v_status;
  end if;
  update public.gate_passes
     set status = 'issued', authorized_by = auth.uid(), authorized_at = now()
   where id = p_pass_id;
end; $$;

grant execute on function public.authorize_gate_pass(uuid) to authenticated;
