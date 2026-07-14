-- ─── Manager sends the processing fee back to the processing employee ────────
-- "Reopen in place": the manager/owner flags the visit's processing record for
-- correction (no pipeline reset). The processing employee re-edits the machine
-- usage; the processing fee (light bill) is recomputed and the flag cleared.

alter table public.processing_records
  add column if not exists fee_reopened boolean not null default false;

-- Manager (own site) / owner reopens the fee for correction.
create or replace function public.reopen_processing_fee(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text; v_rec uuid;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or (public.current_role() = 'manager' and v_site = public.current_site())) then
    raise exception 'not authorized to send the processing fee back';
  end if;
  if v_state in ('exited', 'stocked') then raise exception 'visit is closed'; end if;
  select id into v_rec from public.processing_records where visit_id = p_visit_id order by created_at desc limit 1;
  if v_rec is null then raise exception 'no processing record to reopen'; end if;
  update public.processing_records set fee_reopened = true where id = v_rec;
end; $$;

grant execute on function public.reopen_processing_fee(uuid) to authenticated;

-- Recompute the light-bill processing fee from the record's machine usage +
-- discount, and clear the reopened flag. Callable by the processing employee
-- (own site), a manager (own site), or the owner.
create or replace function public.sync_processing_fee(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_rec_id uuid; v_discount numeric; v_gross numeric; v_fee numeric; v_desc text;
begin
  select site_id into v_site from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner()
          or (public.current_role() in ('processing', 'manager') and v_site = public.current_site())) then
    raise exception 'not authorized';
  end if;
  select id, coalesce(discount_percent, 0) into v_rec_id, v_discount
    from public.processing_records where visit_id = p_visit_id order by created_at desc limit 1;
  if v_rec_id is null then return; end if;
  select coalesce(sum(measurement * rate_snapshot), 0) into v_gross
    from public.processing_machine_usage where processing_record_id = v_rec_id;
  v_fee := v_gross * (1 - v_discount / 100.0);
  v_desc := case when v_discount > 0 then 'Processing fee (' || v_discount || '% discount)' else 'Processing fee' end;
  if exists (select 1 from public.utility_charges where visit_id = p_visit_id and kind = 'light_bill') then
    update public.utility_charges set amount = v_fee, description = v_desc
      where visit_id = p_visit_id and kind = 'light_bill';
  elsif v_fee > 0 then
    insert into public.utility_charges (visit_id, kind, description, amount, recorded_by)
    values (p_visit_id, 'light_bill', v_desc, v_fee, auth.uid());
  end if;
  update public.processing_records set fee_reopened = false where id = v_rec_id;
end; $$;

grant execute on function public.sync_processing_fee(uuid) to authenticated;
