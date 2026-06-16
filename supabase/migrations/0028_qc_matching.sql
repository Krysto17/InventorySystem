-- ─── Phase 10 (F): QC↔Receiving matching + analysis rules ────────────────────
-- 1. Magnetic analysis may only be recorded for Monazite (blueprint rule).
-- 2. QC re-records the weight per line; if it differs from receiving's weight
--    by more than 2%, the line is auto-flagged as a mismatch (manager queue).
--    Supplier + material match is structural (xrf FK → visit_materials).
-- 3. Not every supply needs chemical analysis: per-line requires_analysis flag;
--    exempt lines don't block the pipeline. A batch with NO line requiring
--    analysis skips QC entirely (receiving → pricing, a legal legacy edge).

-- Monazite / Zircon were named by the owner but never seeded; add them.
insert into public.material_types (name)
select x from (values ('Monazite'), ('Zircon')) as v(x)
where not exists (select 1 from public.material_types m where m.name = v.x);

alter table public.visit_materials
  add column requires_analysis boolean not null default true;

alter table public.xrf_records
  add column weight_kg numeric(12,3) check (weight_kg >= 0),
  add column mismatch  boolean not null default false;

-- ─── Magnetic analysis only for Monazite ─────────────────────────────────────
create or replace function public._visit_materials_magnetic_rule()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  mname text;
begin
  if NEW.magnetic_analysis is not null then
    select lower(name) into mname from public.material_types where id = NEW.material_type_id;
    if mname is distinct from 'monazite' then
      raise exception 'magnetic analysis is only recorded for Monazite (got %)', mname
        using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger t_visit_materials_magnetic_rule
  before insert or update on public.visit_materials
  for each row execute function public._visit_materials_magnetic_rule();

-- ─── QC weight mismatch auto-flag (2% relative tolerance) ────────────────────
create or replace function public._xrf_records_match_check()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  line_weight numeric;
begin
  if NEW.weight_kg is null then
    NEW.mismatch := false;
    return NEW;
  end if;
  select weight_kg into line_weight
    from public.visit_materials where id = NEW.visit_material_id;
  if line_weight is null or line_weight = 0 then
    NEW.mismatch := NEW.weight_kg <> coalesce(line_weight, 0);
  else
    NEW.mismatch := abs(NEW.weight_kg - line_weight) / line_weight > 0.02;
  end if;
  return NEW;
end;
$$;

create trigger t_xrf_records_match_check
  before insert or update on public.xrf_records
  for each row execute function public._xrf_records_match_check();

-- ─── Validator: exempt-only batches may enter pricing without XRF ────────────
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
  all_exempt boolean;
begin
  if NEW.state = OLD.state then
    return NEW;
  end if;

  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'),
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),      -- legacy single-material path + exempt batches
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

  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then
      raise exception 'cannot enter QC without material lines';
    end if;
  end if;

  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials
                       where visit_id = NEW.id and requires_analysis)
      into all_exempt;
    if not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

-- ─── Receiving "send onward": skip QC when no line requires analysis ─────────
create or replace function public.advance_visit_to_qc(p_visit_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_site uuid;
  v_state text;
  n int;
  n_required int;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then
    raise exception 'visit not found';
  end if;
  if not (public.is_owner()
          or (public.current_role() = 'receiving' and v_site = public.current_site())) then
    raise exception 'not authorized to advance this visit';
  end if;
  if v_state <> 'in_receiving' then
    raise exception 'visit is not in receiving';
  end if;
  select count(*), count(*) filter (where requires_analysis)
    into n, n_required
    from public.visit_materials where visit_id = p_visit_id;
  if n = 0 then
    raise exception 'cannot advance to QC without material lines';
  end if;
  if n_required = 0 then
    update public.visits set state = 'pricing' where id = p_visit_id;
  else
    update public.visits set state = 'in_qc' where id = p_visit_id;
  end if;
end;
$$;

-- ─── XRF completion: only lines that REQUIRE analysis gate the advance ───────
create or replace function public._xrf_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_visit uuid;
  v_state text;
  required int;
  submitted_count int;
begin
  select vm.visit_id into v_visit
    from public.visit_materials vm where vm.id = NEW.visit_material_id;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (
    v_visit,
    case when TG_OP = 'INSERT' then 'record_created' else 'record_edited' end,
    auth.uid(),
    jsonb_build_object('table', 'xrf_records', 'record_id', NEW.id,
                       'submitted', NEW.submitted, 'mismatch', NEW.mismatch)
  );

  select count(*) filter (where vm.requires_analysis) into required
    from public.visit_materials vm where vm.visit_id = v_visit;
  select count(*) into submitted_count
    from public.visit_materials vm
    join public.xrf_records x on x.visit_material_id = vm.id
   where vm.visit_id = v_visit and vm.requires_analysis and x.submitted;

  select state into v_state from public.visits where id = v_visit;
  if v_state = 'in_qc' and required > 0 and submitted_count = required then
    update public.visits set state = 'pricing' where id = v_visit;
  end if;

  return NEW;
end;
$$;
