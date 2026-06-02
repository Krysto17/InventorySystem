create table public.analysis_records (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null unique references public.visits(id) on delete cascade,
  weight            numeric(12,3) not null check (weight >= 0),
  sample_id         text,
  xrf_result        jsonb,
  purity            numeric(5,2) check (purity >= 0 and purity <= 100),
  grade             text,
  qc_observations   text,
  analyzed_at       timestamptz,
  recorded_by       uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create or replace function public._analysis_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'analysis_records', 'record_id', NEW.id));

    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_receiving' then
      update public.visits set state = 'pricing' where id = NEW.visit_id;
    end if;
    return NEW;
  end if;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'analysis_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));

  -- If weight changed, recompute pricing.purchase_amount by touching the pricing row
  if NEW.weight is distinct from OLD.weight then
    update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  end if;

  return NEW;
end;
$$;

create trigger t_analysis_records_audit
  after insert or update on public.analysis_records
  for each row execute function public._analysis_records_after();

create trigger t_analysis_records_touch
  before update on public.analysis_records
  for each row execute function public._touch_updated_at();

alter table public.analysis_records enable row level security;

create policy "analysis_records: read own site"
  on public.analysis_records
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = analysis_records.visit_id
                 and v.site_id = public.current_site())
  );

create policy "analysis_records: receiving inserts when visit in_receiving"
  on public.analysis_records
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
  );

create policy "analysis_records: receiving updates own site while open"
  on public.analysis_records
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(analysis_records.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(analysis_records.visit_id)
    )
  );
