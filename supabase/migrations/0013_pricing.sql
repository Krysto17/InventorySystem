create table public.pricing (
  id                  uuid primary key default gen_random_uuid(),
  visit_id            uuid not null unique references public.visits(id) on delete cascade,
  unit_price          numeric(12,2) check (unit_price >= 0),
  purchase_amount     numeric(14,2),
  agreement_status    text not null default 'pending'
                          check (agreement_status in ('pending','agreed','not_agreed')),
  payment_terms       text check (payment_terms in ('immediate','deferred','installment','deducted')),
  priced_by           uuid references public.profiles(id),
  overridden_by       uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agreed_requires_price check (agreement_status <> 'agreed' or unit_price is not null),
  constraint agreed_requires_terms check (agreement_status <> 'agreed' or payment_terms is not null)
);

-- Maintain purchase_amount = unit_price × analysis_records.weight
create or replace function public._pricing_set_purchase_amount()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  w numeric;
begin
  select weight into w from public.analysis_records where visit_id = NEW.visit_id;
  if NEW.unit_price is null or w is null then
    NEW.purchase_amount := null;
  else
    NEW.purchase_amount := NEW.unit_price * w;
  end if;
  return NEW;
end;
$$;

create trigger t_pricing_purchase_amount
  before insert or update on public.pricing
  for each row execute function public._pricing_set_purchase_amount();

-- Audit + state transition
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
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger t_pricing_audit
  after insert or update on public.pricing
  for each row execute function public._pricing_after();

create trigger t_pricing_touch
  before update on public.pricing
  for each row execute function public._touch_updated_at();

alter table public.pricing enable row level security;

create policy "pricing: read own site"
  on public.pricing
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = pricing.visit_id
                 and v.site_id = public.current_site())
  );

create policy "pricing: manager inserts when visit pricing"
  on public.pricing
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'pricing')
    )
  );

create policy "pricing: manager updates own site while open"
  on public.pricing
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(pricing.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(pricing.visit_id)
    )
  );
