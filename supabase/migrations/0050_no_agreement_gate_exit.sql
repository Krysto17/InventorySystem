-- ─── Restore the no-agreement gate-exit flow (Phase 1/2, manager-or-owner) ───
-- Phase 7 made no-agreement visits go pricing → exited directly. This brings
-- back the Phase 1/2 release gate: a visit with no pricing agreement parks at
-- `awaiting_gate_exit`; a manager OR the owner authorises the exit; then the
-- gate releases the supplier (→ exited). (Phase 2 was owner-only — the business
-- now lets the manager authorise too.)

-- ── 1. Recreate the gate-exit-authorization record ───────────────────────────
create table if not exists public.gate_exit_authorizations (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null unique references public.visits(id) on delete cascade,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  note          text
);

create or replace function public._gate_exit_authorized_after()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'gate_exit_authorized', NEW.authorized_by,
          jsonb_build_object('authorized_by', NEW.authorized_by, 'note', NEW.note));
  return NEW;
end; $$;

drop trigger if exists t_gate_exit_authorized on public.gate_exit_authorizations;
create trigger t_gate_exit_authorized
  after insert on public.gate_exit_authorizations
  for each row execute function public._gate_exit_authorized_after();

alter table public.gate_exit_authorizations enable row level security;

drop policy if exists "gea: read own site or owner" on public.gate_exit_authorizations;
create policy "gea: read own site, cross-site reader, or owner"
  on public.gate_exit_authorizations for select to authenticated
  using (
    public.is_owner()
    or public.has_cross_site_read()
    or exists (select 1 from public.visits v
               where v.id = gate_exit_authorizations.visit_id
                 and v.site_id = public.current_site())
  );

drop policy if exists "gea: owner inserts only" on public.gate_exit_authorizations;
create policy "gea: manager (own site) or owner authorises"
  on public.gate_exit_authorizations for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager'
        and exists (select 1 from public.visits v
                    where v.id = gate_exit_authorizations.visit_id
                      and v.site_id = public.current_site()))
  );

-- ── 2. Re-add awaiting_gate_exit to the visit state CHECK ─────────────────────
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'at_gate_in','in_processing','in_receiving','in_qc','pricing','awaiting_gate_exit',
  'in_accounting','exited','awaiting_stock_intake','stocked'
));

-- ── 3. State machine: pricing → awaiting_gate_exit → exited (needs auth) ──────
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_submitted_xrf boolean;
  has_lines boolean;
  all_exempt boolean;
  has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;

  is_legal := (OLD.state, NEW.state) in (
    ('at_gate_in','in_processing'),
    ('at_gate_in','in_receiving'),
    ('in_processing','in_receiving'),
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),
    ('in_qc','pricing'),
    ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'),
    ('pricing','exited'),
    ('pricing','stocked'),
    ('awaiting_gate_exit','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','stocked'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state using errcode = '22000';
  end if;

  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot enter QC without material lines'; end if;
  end if;

  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis)
      into all_exempt;
    if not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  -- The gate can only release once a manager/owner has authorised the exit.
  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id)
      into has_authorization;
    if not has_authorization then
      raise exception 'cannot release without a gate exit authorization';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end; $$;

-- ── 4. Audit override list mirrors the legal forward edges ────────────────────
create or replace function public._visits_write_audit()
  returns trigger language plpgsql security definer set search_path = public as $$
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
    values (NEW.id, 'state_changed', auth.uid(),
            jsonb_build_object('from', OLD.state, 'to', NEW.state));

    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('at_gate_in','in_processing'),
      ('at_gate_in','in_receiving'),
      ('in_processing','in_receiving'),
      ('in_receiving','in_qc'),
      ('in_receiving','pricing'),
      ('in_qc','pricing'),
      ('pricing','in_accounting'),
      ('pricing','awaiting_gate_exit'),
      ('pricing','exited'),
      ('pricing','stocked'),
      ('awaiting_gate_exit','exited'),
      ('in_accounting','awaiting_stock_intake'),
      ('in_accounting','stocked'),
      ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;

  return NEW;
end; $$;

-- ── 5. No-agreement pricing now routes to awaiting_gate_exit (not exited) ──────
create or replace function public._pricing_after()
  returns trigger language plpgsql security definer set search_path = public as $$
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
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end; $$;
