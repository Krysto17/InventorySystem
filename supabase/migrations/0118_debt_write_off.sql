-- ─── Writing a debt off is not the same as collecting it ────────────────────
-- Clearing a balance is recorded as a deduction so the audit trail survives —
-- but a write-off is forgiven money, not money received. Without a marker it
-- would inflate "processing fees collected" by the amount forgiven.

alter table public.advance_deductions
  add column if not exists is_write_off boolean not null default false;

comment on column public.advance_deductions.is_write_off is
  'True when the balance was forgiven/reset rather than actually recovered. Reduces the debt but must be excluded from "collected" revenue figures.';

-- Clear a supplier's processing (light-bill) debt as a write-off. Owner only —
-- this forgives money owed.
create or replace function public.write_off_processing_debt(
  p_supplier_id uuid,
  p_note text default 'Opening write-off — starting fresh'
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_debt numeric; v_site uuid;
begin
  if not public.is_owner() then
    raise exception 'only the owner can write off a debt';
  end if;

  v_debt := public.supplier_processing_debt(p_supplier_id);
  if v_debt <= 0 then return 0; end if;

  -- Attach to the supplier's most recent visit site, else any site.
  select v.site_id into v_site from public.visits v
    where v.supplier_id = p_supplier_id order by v.created_at desc limit 1;
  if v_site is null then
    select id into v_site from public.sites order by created_at limit 1;
  end if;

  insert into public.advance_deductions
    (supplier_id, site_id, ref_visit_id, amount, notes, recorded_by, kind, is_write_off)
  values (p_supplier_id, v_site, null, v_debt, btrim(p_note), auth.uid(), 'processing', true);

  return v_debt;
end; $$;

grant execute on function public.write_off_processing_debt(uuid, text) to authenticated;
