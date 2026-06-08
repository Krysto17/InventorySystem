-- ─── Phase 7: Gate role removal ──────────────────────────────────────────────
-- Removes the gate intake stage + the gate-exit-authorization flow entirely.
-- Visits are now created directly by the `processing` role. No-agreement visits
-- transition pricing → exited directly (no owner authorization, no gate release).
--
-- NOTE on the `app_role` enum: Postgres cannot DROP a value from an enum without
-- recreating the type, which would CASCADE-drop every RLS policy in the app. To
-- keep this migration safe and reproducible (`npx supabase db reset` must pass),
-- the orphan 'gate' enum value is intentionally LEFT in place. The application
-- no longer offers it (removed from src/lib/auth/roles.ts), so no new gate users
-- can be provisioned, and every gate *policy*, *table*, *state*, and *flow* is
-- removed below. Existing gate accounts must be deleted/re-provisioned by the
-- owner before deploy (their role value stays valid but has no home route).

-- ─── 1. Drop the gate-exit-authorization table (policies/triggers cascade) ────
drop table if exists public.gate_exit_authorizations cascade;

-- ─── 2. Narrow the visits.state CHECK constraint ─────────────────────────────
-- Remove at_gate_in (no gate intake) and awaiting_gate_exit (no gate release).
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'in_processing','in_receiving','pricing','in_accounting',
  'exited','awaiting_stock_intake','stocked'
));

-- ─── 3. Rewrite the state-machine validation trigger ─────────────────────────
create or replace function public._visits_validate_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_legal boolean;
  has_analysis boolean;
begin
  if NEW.state = OLD.state then
    return NEW;
  end if;

  -- Allowed forward transitions (gate-free)
  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'),
    ('in_receiving','pricing'),
    ('pricing','in_accounting'),
    ('pricing','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state
      using errcode = '22000';
  end if;

  -- Pricing requires an analysis record (applies to owner too)
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    if not has_analysis then
      raise exception 'cannot enter pricing without analysis_records row';
    end if;
  end if;

  -- Terminal entry sets closed_at
  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

-- ─── 4. Rewrite the visit audit trigger (owner_override transition list) ──────
create or replace function public._visits_write_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'visit_created', NEW.created_by,
      jsonb_build_object(
        'entry_path', NEW.entry_path,
        'supplier_id', NEW.supplier_id,
        'declared_material_type_id', NEW.declared_material_type_id,
        'vehicle_plate', NEW.vehicle_plate,
        'site_id', NEW.site_id
      )
    );
    return NEW;
  end if;

  if NEW.state <> OLD.state then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'state_changed', auth.uid(),
      jsonb_build_object('from', OLD.state, 'to', NEW.state)
    );

    -- Owner-override detection: owner moved along a non-forward edge
    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('in_processing','in_receiving'),
      ('in_receiving','pricing'),
      ('pricing','in_accounting'),
      ('pricing','exited'),
      ('in_accounting','awaiting_stock_intake'),
      ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;

  return NEW;
end;
$$;

-- ─── 5. Rewrite the pricing transition trigger (not_agreed → exited) ──────────
create or replace function public._pricing_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
  target_state text := null;
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
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_edited', auth.uid(),
            jsonb_build_object(
              'table', 'pricing', 'record_id', NEW.id,
              'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))));
  end if;

  if NEW.agreement_status = 'agreed'      then target_state := 'in_accounting'; end if;
  if NEW.agreement_status = 'not_agreed'  then target_state := 'exited'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end;
$$;

-- ─── 6. Visits RLS: processing replaces gate for create/edit ──────────────────
drop policy if exists "visits: gate inserts own site" on public.visits;
create policy "visits: processing inserts own site"
  on public.visits
  for insert to authenticated
  with check (
    (public.current_role() = 'processing' and site_id = public.current_site())
    or public.is_owner()
  );

drop policy if exists "visits: gate updates own site" on public.visits;
create policy "visits: processing updates own site"
  on public.visits
  for update to authenticated
  using (
    (public.current_role() = 'processing' and site_id = public.current_site())
    or public.is_owner()
  )
  with check (
    (public.current_role() = 'processing' and site_id = public.current_site())
    or public.is_owner()
  );
