-- ─── Delete a whole batch supply (one visit) (#4/#5) ────────────────────────
-- A "batch supply" is a visit plus its lines, analyses, pricing, payments and
-- settlement (all on-delete-cascade). Two roles may remove one, gated by the
-- batch_settlements lifecycle (pending → approved [owner] → paid [accounting]):
--   • General (New-Site) manager — ANY site's batch, while NOT yet owner-approved.
--   • Owner — any batch, until it is marked paid.
-- Done via a SECURITY DEFINER RPC so it can clear the two restrict-FK children
-- (advance_deductions, stock_movements guard) and enforce the role gates in one
-- place. All deletes are audited by the caller's role check; the visit's
-- transaction_events cascade away with it.

create or replace function public.delete_batch(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_settle_status text;
begin
  if not exists (select 1 from public.visits where id = p_visit_id) then
    raise exception 'visit not found';
  end if;

  select status into v_settle_status
    from public.batch_settlements where visit_id = p_visit_id;

  -- Authorization + delete gate.
  if public.is_owner() then
    if v_settle_status = 'paid' then
      raise exception 'cannot delete a batch that has been paid';
    end if;
  elsif public.is_general_manager() then
    if v_settle_status in ('approved', 'paid') then
      raise exception 'cannot delete a batch the owner has already approved';
    end if;
  else
    raise exception 'not authorized to delete batches';
  end if;

  -- A batch with stock movements has been stocked (and therefore paid) — refuse
  -- rather than orphan the inventory ledger.
  if exists (select 1 from public.stock_movements where ref_visit_id = p_visit_id) then
    raise exception 'cannot delete a batch that already has stock movements';
  end if;

  -- advance_deductions is a restrict FK; the recovery rows belong to this
  -- un-approved settlement, so clear them, then delete the visit (rest cascades).
  delete from public.advance_deductions where ref_visit_id = p_visit_id;
  delete from public.visits where id = p_visit_id;
end; $$;

grant execute on function public.delete_batch(uuid) to authenticated;
