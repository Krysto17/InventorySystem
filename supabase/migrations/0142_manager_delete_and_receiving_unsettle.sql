-- ─── Two permissions widened to match how the sites actually work ───────────
-- 1. Deleting a mistaken batch was the general manager's alone. Every site
--    manager runs their own site's pricing, so every site manager may remove a
--    batch on their own site — up to the moment the owner approves it. After
--    that it is a decided payable and only the owner can undo it.
--
-- 2. Unsettling a line — pulling material out of a batch because it fails spec
--    or no price was agreed — was manager and owner only. Receiving handles the
--    material physically and spots this first, so receiving may unsettle on
--    their own site.
--
--    But receiving does NOT get to authorise material leaving the yard. 0119
--    established that receiving RAISES a gate pass and a manager authorises it;
--    unsettling as receiving therefore raises a PENDING pass, not an issued one
--    signed by the person who raised it. A manager still has to sign it off
--    before the material can go.

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
  elsif v_role = 'manager' and v_site = public.current_site() then
    -- Any site manager, on their own site, until the owner has approved it.
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

create or replace function public.unsettle_line(p_line_id uuid, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_visit uuid; v_site uuid; v_supplier uuid; v_mat uuid; v_weight numeric;
  v_settle_status text; v_state text; v_is_receiving boolean;
begin
  select vm.visit_id, v.site_id, v.supplier_id, vm.material_type_id, vm.weight_kg, v.state
    into v_visit, v_site, v_supplier, v_mat, v_weight, v_state
    from public.visit_materials vm join public.visits v on v.id = vm.visit_id
    where vm.id = p_line_id;
  if v_visit is null then raise exception 'line not found'; end if;

  v_is_receiving := public.current_role() = 'receiving' and v_site = public.current_site();

  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() = 'manager' and v_site = public.current_site())
          or v_is_receiving) then
    raise exception 'not authorized to unsettle this line';
  end if;

  -- Receiving works the batch before the money does. Once a settlement exists
  -- the figures have been assembled from these lines, so pulling one out is the
  -- manager's call, not theirs.
  if v_is_receiving then
    select status into v_settle_status
      from public.batch_settlements where visit_id = v_visit;
    if v_settle_status is not null then
      raise exception 'this batch already has a settlement — ask the manager to unsettle it';
    end if;
    if v_state in ('stocked', 'exited') then
      raise exception 'cannot unsettle a line on a batch that is already %', v_state;
    end if;
  end if;

  update public.visit_materials
    set settlement_status = 'unsettled', unsettled_reason = nullif(p_reason, '')
    where id = p_line_id;

  if not exists (select 1 from public.gate_passes where visit_material_id = p_line_id and status <> 'cancelled') then
    insert into public.gate_passes
      (site_id, supplier_id, material_type_id, weight_kg, reason, visit_material_id,
       issued_by, status, requested_by, authorized_by, authorized_at)
    values (
      v_site, v_supplier, v_mat, v_weight,
      coalesce(nullif(p_reason, ''), 'Released — does not meet specification/pricing'),
      p_line_id, auth.uid(),
      -- Receiving raises the pass; a manager authorises it before the material
      -- can leave. Manager/owner sign their own on the spot.
      case when v_is_receiving then 'pending' else 'issued' end,
      case when v_is_receiving then auth.uid() else null end,
      case when v_is_receiving then null else auth.uid() end,
      case when v_is_receiving then null else now() end
    );
  end if;
end; $$;
