create table public.gate_exit_authorizations (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null unique references public.visits(id) on delete cascade,
  authorized_by   uuid not null references public.profiles(id),
  authorized_at   timestamptz not null default now(),
  note            text
);

create or replace function public._gate_exit_authorized_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'gate_exit_authorized', NEW.authorized_by,
          jsonb_build_object('authorized_by', NEW.authorized_by, 'note', NEW.note));
  return NEW;
end;
$$;

create trigger t_gate_exit_authorized
  after insert on public.gate_exit_authorizations
  for each row execute function public._gate_exit_authorized_after();

alter table public.gate_exit_authorizations enable row level security;

create policy "gea: read own site or owner"
  on public.gate_exit_authorizations
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = gate_exit_authorizations.visit_id
                 and v.site_id = public.current_site())
  );

create policy "gea: owner inserts only"
  on public.gate_exit_authorizations
  for insert to authenticated
  with check (public.is_owner());
