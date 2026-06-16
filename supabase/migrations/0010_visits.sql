create table public.visits (
  id                          uuid primary key default gen_random_uuid(),
  site_id                     uuid not null references public.sites(id),
  supplier_id                 uuid not null references public.suppliers(id),
  vehicle_plate               text,
  declared_material_type_id   uuid not null references public.material_types(id),
  entry_path                  text not null check (entry_path in ('unprocessed','pre_processed')),
  state                       text not null check (state in (
                                 'at_gate_in','in_processing','in_receiving','pricing',
                                 'in_accounting','awaiting_gate_exit','exited',
                                 'awaiting_stock_intake','stocked')),
  created_at                  timestamptz not null default now(),
  created_by                  uuid not null references public.profiles(id),
  closed_at                   timestamptz
);

create index visits_site_state_idx on public.visits (site_id, state);
create index visits_supplier_idx   on public.visits (supplier_id);

-- Now that visits exists, add the deferred FK on transaction_events.
alter table public.transaction_events
  add constraint transaction_events_visit_id_fkey
  foreign key (visit_id) references public.visits(id) on delete cascade;

-- Replace owner-only read policy with site-scoped per-visit read.
drop policy if exists "transaction_events: owner reads all" on public.transaction_events;
create policy "transaction_events: read by visit visibility"
  on public.transaction_events
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = transaction_events.visit_id
                 and v.site_id = public.current_site())
  );

-- Helper used by child-record RLS update policies.
create or replace function public.visit_is_open(_visit_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select state not in ('exited','stocked') from public.visits where id = _visit_id;
$$;

-- ─── State-machine validation (BEFORE UPDATE OF state) ──────────────────
create or replace function public._visits_validate_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_authorization boolean;
begin
  if NEW.state = OLD.state then
    return NEW;
  end if;

  -- Allowed forward transitions
  is_legal := (OLD.state, NEW.state) in (
    ('at_gate_in','in_processing'),
    ('at_gate_in','in_receiving'),
    ('in_processing','in_receiving'),
    ('in_receiving','pricing'),
    ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'),
    ('awaiting_gate_exit','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state
      using errcode = '22000';
  end if;

  -- Invariants on forward transitions (applied to owner too)
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    if not has_analysis then
      raise exception 'cannot enter pricing without analysis_records row';
    end if;
  end if;

  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id) into has_authorization;
    if not has_authorization then
      raise exception 'cannot exit without gate_exit_authorizations row';
    end if;
  end if;

  -- Terminal entry sets closed_at
  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

create trigger t_visits_state_machine
  before update of state on public.visits
  for each row execute function public._visits_validate_transition();

-- ─── Visit audit trigger (AFTER INSERT / AFTER UPDATE OF state) ─────────
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

    -- Owner-override detection: owner moved to a non-forward state
    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('at_gate_in','in_processing'),
      ('at_gate_in','in_receiving'),
      ('in_processing','in_receiving'),
      ('in_receiving','pricing'),
      ('pricing','in_accounting'),
      ('pricing','awaiting_gate_exit'),
      ('awaiting_gate_exit','exited'),
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

create trigger t_visits_audit_insert
  after insert on public.visits
  for each row execute function public._visits_write_audit();

create trigger t_visits_audit_update
  after update of state on public.visits
  for each row execute function public._visits_write_audit();

-- ─── RLS on visits ──────────────────────────────────────────────────────
alter table public.visits enable row level security;

-- Read: own site for non-owner, all sites for owner
create policy "visits: read own site"
  on public.visits
  for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Insert: gate role only, on own site (or owner)
create policy "visits: gate inserts own site"
  on public.visits
  for insert to authenticated
  with check (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  );

-- Update: gate (own site) + owner; triggers update state on behalf of other roles via SECURITY DEFINER
create policy "visits: gate updates own site"
  on public.visits
  for update to authenticated
  using (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  )
  with check (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  );

-- Column-level GRANTs: restrict which fields authenticated users may set
revoke update on public.visits from authenticated;
grant update (supplier_id, vehicle_plate, declared_material_type_id, entry_path, state) on public.visits to authenticated;
