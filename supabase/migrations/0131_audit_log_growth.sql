-- ─── Stop the audit log recording edits that changed nothing ────────────────
-- transaction_events grew to 10,560 rows in its first month — by far the
-- fastest-growing table in the database. A large slice of that records nothing:
--
--  * _visit_materials_after re-saves the parent pricing row ("update pricing
--    set unit_price = unit_price") to recompute the batch total. That fires
--    _pricing_after, which logs an edit — 731 of 758 pricing edits in the first
--    month were this and nothing else.
--  * Any touch of a row bumps updated_at, so even a genuine no-op update came
--    out as a "change".
--
-- Two changes: updated_at no longer counts as a business change, and an audit
-- row is only written when something actually changed. The history keeps every
-- real edit; it stops keeping the echoes.

-- Bookkeeping columns are not business changes.
create or replace function public.jsonb_diff_changed(old jsonb, new jsonb)
  returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old->k, 'new', new->k)), '{}'::jsonb)
  from jsonb_object_keys(coalesce(new, '{}'::jsonb)) k
  where (old->k) is distinct from (new->k)
    and k not in ('updated_at', 'created_at');
$$;

create or replace function public._visit_materials_after()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_diff jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id,
                               'material_type_id', NEW.material_type_id,
                               'weight_kg', NEW.weight_kg));
  else
    v_diff := public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW));
    if v_diff <> '{}'::jsonb then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.visit_id, 'record_edited', auth.uid(),
              jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id, 'diff', v_diff));
    end if;
  end if;

  -- Keep the per-visit pricing.purchase_amount in sync (multi-material sum).
  -- This is a no-op write whose only purpose is to fire the pricing recompute,
  -- so it must not leave an audit trail of its own.
  update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  return NEW;
end; $$;

create or replace function public._pricing_after()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_state text; target_state text := null; v_diff jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.priced_by,
            jsonb_build_object('table', 'pricing', 'record_id', NEW.id,
                               'fields', jsonb_build_object(
                                 'unit_price', NEW.unit_price,
                                 'agreement_status', NEW.agreement_status,
                                 'payment_terms', NEW.payment_terms)));
  else
    v_diff := public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW));
    if v_diff <> '{}'::jsonb then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.visit_id, 'record_edited', auth.uid(),
              jsonb_build_object('table', 'pricing', 'record_id', NEW.id, 'diff', v_diff));
    end if;
  end if;

  if NEW.agreement_status = 'agreed'      then target_state := 'awaiting_price_approval'; end if;
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end; $$;

-- _analysis_records_after and _processing_records_after also carry the visit's
-- state transitions, and between them logged six edits in the first month —
-- not worth rewriting a state machine for. The jsonb_diff_changed change above
-- already slims what they record.

-- ── Clear out the echoes already recorded ───────────────────────────────────
-- Only rows whose diff is empty once updated_at/created_at are set aside: they
-- state that nothing changed, so deleting them loses no history.
delete from public.transaction_events
 where event_type = 'record_edited'
   and payload ? 'diff'
   and ((payload->'diff') - 'updated_at' - 'created_at') = '{}'::jsonb;

-- ── Retention for the long run ──────────────────────────────────────────────
-- Edits are the bulk and the least valuable once a visit is long closed; the
-- workflow story (created, state changes, gate exits) is kept forever. Owner
-- runs this when they want the space back — nothing deletes itself.
create or replace function public.prune_transaction_events(p_older_than interval default '18 months')
  returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_owner() then
    raise exception 'only the owner can prune the audit log';
  end if;
  with gone as (
    delete from public.transaction_events te
     using public.visits v
     where v.id = te.visit_id
       and v.state in ('stocked', 'exited')
       and te.event_type = 'record_edited'
       and te.created_at < now() - p_older_than
    returning te.id
  )
  select count(*) into n from gone;
  return n;
end; $$;

grant execute on function public.prune_transaction_events(interval) to authenticated;
