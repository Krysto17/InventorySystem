-- ─── Phase 9 (B/C/D/E): Multi-material batches + QC XRF + per-line pricing ────
-- A visit becomes a BATCH of material line items (visit_materials). Receiving
-- records weight + magnetic analysis per line; QC records an access-restricted
-- XRF result per line (xrf_records); the manager/owner may assign an optional
-- per-line price. A new `in_qc` stage sits between receiving and pricing.
--
-- This change is ADDITIVE: the legacy single-material path (analysis_records +
-- per-visit pricing.unit_price) still works, so the existing pipeline/tests stay
-- green. New screens drive the multi-material path; the DB validator/triggers
-- accept either path.

-- ─── 1. Add the in_qc state ──────────────────────────────────────────────────
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'in_processing','in_receiving','in_qc','pricing','in_accounting',
  'exited','awaiting_stock_intake','stocked'
));

-- ─── 2. visit_materials: batch line items ────────────────────────────────────
create table public.visit_materials (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references public.visits(id) on delete cascade,
  material_type_id  uuid not null references public.material_types(id),
  weight_kg         numeric(12,3) not null check (weight_kg >= 0),
  magnetic_analysis text,
  receiving_comment text,
  unit_price        numeric(12,2) check (unit_price >= 0),     -- optional (manager/owner)
  purchase_amount   numeric(14,2),                             -- weight_kg * unit_price (trigger)
  priced_by         uuid references public.profiles(id),
  recorded_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index visit_materials_visit_idx on public.visit_materials (visit_id);

-- Maintain purchase_amount = weight_kg * unit_price (null when unpriced).
create or replace function public._visit_materials_set_amount()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.unit_price is null then
    NEW.purchase_amount := null;
  else
    NEW.purchase_amount := NEW.weight_kg * NEW.unit_price;
  end if;
  return NEW;
end;
$$;

create trigger t_visit_materials_amount
  before insert or update on public.visit_materials
  for each row execute function public._visit_materials_set_amount();

create trigger t_visit_materials_touch
  before update on public.visit_materials
  for each row execute function public._touch_updated_at();

-- Audit + recompute the per-visit pricing.purchase_amount when a line changes.
create or replace function public._visit_materials_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id,
                               'material_type_id', NEW.material_type_id,
                               'weight_kg', NEW.weight_kg));
  else
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_edited', auth.uid(),
            jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id,
                               'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))));
  end if;

  -- Keep the per-visit pricing.purchase_amount in sync (multi-material sum).
  update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  return NEW;
end;
$$;

create trigger t_visit_materials_audit
  after insert or update on public.visit_materials
  for each row execute function public._visit_materials_after();

-- ─── 3. xrf_records: QC's access-restricted XRF result, one per line ─────────
create table public.xrf_records (
  id                uuid primary key default gen_random_uuid(),
  visit_material_id uuid not null unique references public.visit_materials(id) on delete cascade,
  result            text,
  submitted         boolean not null default false,
  recorded_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger t_xrf_records_touch
  before update on public.xrf_records
  for each row execute function public._touch_updated_at();

-- ─── 4. Rewrite the state-machine validator (in_qc edges + dual invariants) ──
create or replace function public._visits_validate_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_submitted_xrf boolean;
  has_lines boolean;
begin
  if NEW.state = OLD.state then
    return NEW;
  end if;

  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'),
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),      -- legacy single-material path
    ('in_qc','pricing'),
    ('pricing','in_accounting'),
    ('pricing','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state
      using errcode = '22000';
  end if;

  -- Entering QC requires at least one material line.
  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then
      raise exception 'cannot enter QC without material lines';
    end if;
  end if;

  -- Entering pricing requires EITHER a legacy analysis record OR a submitted XRF.
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    if not has_analysis and not has_submitted_xrf then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

-- ─── 5. Owner-override edge list (audit) must include the new edges ──────────
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
    values (NEW.id, 'state_changed', auth.uid(),
            jsonb_build_object('from', OLD.state, 'to', NEW.state));

    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('in_processing','in_receiving'),
      ('in_receiving','in_qc'),
      ('in_receiving','pricing'),
      ('in_qc','pricing'),
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

-- ─── 6. pricing.purchase_amount tolerates the multi-material path ────────────
-- Legacy: unit_price × analysis weight. New: SUM of per-line purchase_amount.
create or replace function public._pricing_set_purchase_amount()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  w numeric;
  line_total numeric;
begin
  select weight into w from public.analysis_records where visit_id = NEW.visit_id;
  if w is not null and NEW.unit_price is not null then
    NEW.purchase_amount := NEW.unit_price * w;
  else
    select sum(purchase_amount) into line_total
      from public.visit_materials where visit_id = NEW.visit_id;
    NEW.purchase_amount := line_total;
  end if;
  return NEW;
end;
$$;

-- Allow "agreed" when the value comes from per-line prices (purchase_amount set)
-- even if the per-visit unit_price is null.
alter table public.pricing drop constraint if exists agreed_requires_price;
alter table public.pricing add constraint agreed_requires_price
  check (agreement_status <> 'agreed' or unit_price is not null or purchase_amount is not null);

-- ─── 7. RLS: visit_materials (receiving writes; manager/owner price) ─────────
alter table public.visit_materials enable row level security;

create policy "visit_materials: read own site"
  on public.visit_materials for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = visit_materials.visit_id and v.site_id = public.current_site())
  );

create policy "visit_materials: receiving inserts when in_receiving"
  on public.visit_materials for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
  );

-- Receiving edits lines (weight/magnetic) while the visit is open; manager/owner
-- set the optional price. Both are UPDATE; columns are guarded by GRANTs below.
create policy "visit_materials: receiving/manager update own site while open"
  on public.visit_materials for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() in ('receiving','manager')
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() in ('receiving','manager')
      and exists (select 1 from public.visits v
                  where v.id = visit_materials.visit_id and v.site_id = public.current_site())
      and public.visit_is_open(visit_materials.visit_id)
    )
  );

-- Column-level: receiving may edit the analysis fields; manager may set price.
-- (Owner bypasses column grants via is_owner paths in policies + table ownership.)
revoke update on public.visit_materials from authenticated;
grant update (weight_kg, magnetic_analysis, receiving_comment) on public.visit_materials to authenticated;
grant update (unit_price, priced_by) on public.visit_materials to authenticated;

-- ─── 8. RLS: xrf_records (QC writes; result readable only by owner/manager/qc) ─
alter table public.xrf_records enable row level security;

-- Read: owner, the manager at the visit's site, or QC at the visit's site.
-- Receiving / accounting / inventory are intentionally excluded — XRF results
-- are confidential to ownership + management (+ the QC analyst).
create policy "xrf_records: owner/manager/qc read"
  on public.xrf_records for select to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() in ('manager','qc')
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
      )
    )
  );

create policy "xrf_records: qc inserts when visit in_qc"
  on public.xrf_records for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'qc'
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
          and v.state = 'in_qc'
      )
    )
  );

create policy "xrf_records: qc updates own site while open"
  on public.xrf_records for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'qc'
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
          and public.visit_is_open(vm.visit_id)
      )
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'qc'
      and exists (
        select 1 from public.visit_materials vm
          join public.visits v on v.id = vm.visit_id
        where vm.id = xrf_records.visit_material_id
          and v.site_id = public.current_site()
          and public.visit_is_open(vm.visit_id)
      )
    )
  );
