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
create policy "gate_passes: receiving requests own site"
  on public.gate_passes for insert to authenticated
  with check (
    public.current_role() = 'receiving'
    and site_id = public.current_site()
    and status = 'pending'
  );

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
