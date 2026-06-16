create table public.processing_records (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null unique references public.visits(id) on delete cascade,
  recorded_by   uuid not null references public.profiles(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.processing_machine_usage (
  id                     uuid primary key default gen_random_uuid(),
  processing_record_id   uuid not null references public.processing_records(id) on delete cascade,
  machine_id             uuid not null references public.machines(id),
  measurement            numeric(12,3) not null check (measurement >= 0),
  rate_snapshot          numeric(12,2) not null check (rate_snapshot >= 0),
  line_cost              numeric(14,2) generated always as (measurement * rate_snapshot) stored
);

create index pmu_record_idx on public.processing_machine_usage (processing_record_id);

-- ─── Trigger: bumping updated_at on UPDATE ────────────────────────────
create or replace function public._touch_updated_at()
  returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end;
$$;

-- ─── Trigger: audit + transition visit on processing insert ────────────
create or replace function public._processing_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    -- Audit
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'processing_records', 'record_id', NEW.id));

    -- Transition: in_processing → in_receiving
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_processing' then
      update public.visits set state = 'in_receiving' where id = NEW.visit_id;
    end if;

    return NEW;
  end if;

  -- UPDATE: record_edited
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'processing_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));
  return NEW;
end;
$$;

create trigger t_processing_records_audit
  after insert or update on public.processing_records
  for each row execute function public._processing_records_after();

create trigger t_processing_records_touch
  before update on public.processing_records
  for each row execute function public._touch_updated_at();

-- ─── RLS on processing_records ──────────────────────────────────────────
alter table public.processing_records enable row level security;

create policy "processing_records: read own site"
  on public.processing_records
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = processing_records.visit_id
                 and v.site_id = public.current_site())
  );

create policy "processing_records: processing inserts on own site, state=in_processing"
  on public.processing_records
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_processing')
    )
  );

create policy "processing_records: processing updates own site while open"
  on public.processing_records
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(processing_records.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(processing_records.visit_id)
    )
  );

-- ─── RLS on processing_machine_usage (inherits via parent) ─────────────
alter table public.processing_machine_usage enable row level security;

create policy "pmu: read via parent"
  on public.processing_machine_usage
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.processing_records pr
               join public.visits v on v.id = pr.visit_id
               where pr.id = processing_machine_usage.processing_record_id
                 and v.site_id = public.current_site())
  );

create policy "pmu: write via parent"
  on public.processing_machine_usage
  for all to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.processing_records pr
                  join public.visits v on v.id = pr.visit_id
                  where pr.id = processing_machine_usage.processing_record_id
                    and v.site_id = public.current_site()
                    and public.visit_is_open(pr.visit_id))
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.processing_records pr
                  join public.visits v on v.id = pr.visit_id
                  where pr.id = processing_machine_usage.processing_record_id
                    and v.site_id = public.current_site()
                    and public.visit_is_open(pr.visit_id))
    )
  );
