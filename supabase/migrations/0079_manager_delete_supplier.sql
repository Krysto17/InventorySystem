-- ─── Manager may delete a supplier that has no records ──────────────────────
-- Suppliers were owner-delete-only. A manager can now remove a supplier they
-- registered by mistake — but only when nothing references it (no visits,
-- advances, stock lots, gate passes, etc.). Every FK to suppliers is NO ACTION,
-- so the delete raises foreign_key_violation if any record exists; we catch it
-- and return a clear message instead. SECURITY DEFINER so the RPC's own role
-- check governs (bypasses the owner-only delete policy).

create or replace function public.delete_supplier(p_supplier_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.current_role() = 'manager') then
    raise exception 'not authorized to delete suppliers';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier not found';
  end if;
  begin
    delete from public.suppliers where id = p_supplier_id;
  exception when foreign_key_violation then
    raise exception 'This supplier has records and cannot be deleted.';
  end;
end; $$;

grant execute on function public.delete_supplier(uuid) to authenticated;
