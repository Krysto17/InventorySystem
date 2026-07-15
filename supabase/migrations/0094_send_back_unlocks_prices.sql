-- ─── Let the send-back RPC unlock finalized line prices ──────────────────────
-- 0093's accountant_send_back_to_pricing must clear price_finalized so the
-- manager can re-price. But the price-lock trigger (0042) only lets the OWNER
-- flip that flag. We add a transaction-local bypass GUC that the trigger
-- honors, set ONLY inside the send-back RPC.
--
-- Safety: PostgREST runs each request in its own transaction and cannot chain a
-- set_config() with a table write in one request, so a non-owner cannot forge
-- this GUC — it is only ever set together with the update inside this trusted
-- SECURITY DEFINER function.

create or replace function public._visit_materials_price_lock()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only the owner may flip the finalize flag — unless a trusted reversal (the
  -- accountant send-back) has set the transaction-local bypass.
  if NEW.price_finalized is distinct from OLD.price_finalized
     and not public.is_owner()
     and coalesce(current_setting('app.allow_price_unlock', true), '') <> 'on' then
    raise exception 'only the owner can finalize or unfinalize a price';
  end if;

  -- Once finalized, only the owner may change the unit price.
  if OLD.price_finalized
     and NEW.unit_price is distinct from OLD.unit_price
     and not public.is_owner() then
    raise exception 'price is finalized by the owner and can no longer be modified';
  end if;

  -- Stamp who finalized it.
  if NEW.price_finalized and not OLD.price_finalized then
    NEW.finalized_by := coalesce(NEW.finalized_by, auth.uid());
    NEW.finalized_at := coalesce(NEW.finalized_at, now());
  end if;

  return NEW;
end;
$$;

-- Redefine the send-back RPC to raise the bypass before unlocking the lines.
create or replace function public.accountant_send_back_to_pricing(
  p_visit_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_state text; v_site uuid; v_settle text;
begin
  if not (public.current_role() = 'accounting' or public.is_owner()) then
    raise exception 'only accounting may send a batch back for correction';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason for the correction is required';
  end if;
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;
  if v_state <> 'in_accounting' then
    raise exception 'only a batch sitting in accounting can be sent back';
  end if;
  if not (public.is_owner() or public.is_general_accountant() or v_site = public.current_site()) then
    raise exception 'no access to this site';
  end if;

  select status into v_settle from public.batch_settlements
    where visit_id = p_visit_id order by created_at desc limit 1;
  if v_settle = 'paid' then
    raise exception 'this batch is already paid — record a price correction instead';
  end if;

  -- Reverse the approval so the manager can re-price.
  delete from public.batch_settlements where visit_id = p_visit_id and status <> 'paid';
  perform set_config('app.allow_price_unlock', 'on', true); -- transaction-local
  update public.visit_materials set price_finalized = false where visit_id = p_visit_id;
  update public.pricing set agreement_status = 'pending' where visit_id = p_visit_id;
  update public.visits set state = 'pricing' where id = p_visit_id;

  -- Leave the reason in the batch thread the manager already reads.
  insert into public.batch_comments (visit_id, site_id, body, author)
  values (p_visit_id, v_site,
          '↩︎ Sent back by accounting for correction: ' || btrim(p_reason),
          auth.uid());
end; $$;

grant execute on function public.accountant_send_back_to_pricing(uuid, text) to authenticated;
