-- ─── Gate passes + gate movement log (uses the security role from 0047) ──────
-- Security registers material in/out at the gate but cannot authorise outgoing
-- material: a manager/owner issues a gate pass, which Security acknowledges
-- before release. No vehicle data (vehicles were removed from the system).

create sequence if not exists public.gate_pass_seq start 1;

create table public.gate_passes (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id),
  pass_code        text unique,
  supplier_id      uuid references public.suppliers(id),
  material_owner   text,
  material_type_id uuid references public.material_types(id),
  bags             integer check (bags is null or bags >= 0),
  weight_kg        numeric(12,3) check (weight_kg is null or weight_kg >= 0),
  reason           text not null,
  status           text not null default 'issued'
                     check (status in ('issued', 'acknowledged', 'cancelled')),
  issued_by        uuid references public.profiles(id),
  issued_at        timestamptz not null default now(),
  acknowledged_by  uuid references public.profiles(id),
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now()
);

create index gate_passes_site_status_idx on public.gate_passes (site_id, status);

create or replace function public._gate_passes_set_code()
  returns trigger language plpgsql security definer set search_path = public as $$
declare site_code text;
begin
  if NEW.pass_code is null then
    select upper(left(regexp_replace(s.name, '[^A-Za-z]', '', 'g'), 3))
      into site_code from public.sites s where s.id = NEW.site_id;
    NEW.pass_code := 'GP-' || coalesce(site_code, 'MJZ') || '-'
      || lpad(nextval('public.gate_pass_seq')::text, 4, '0');
  end if;
  return NEW;
end; $$;

create trigger t_gate_passes_set_code
  before insert on public.gate_passes
  for each row execute function public._gate_passes_set_code();

create or replace function public._gate_passes_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then return NEW; end if;
  if OLD.status = 'issued' and NEW.status = 'acknowledged' then
    if auth.uid() is not null and public.current_role() <> 'security' then
      raise exception 'only Security can acknowledge a gate pass';
    end if;
    NEW.acknowledged_by := coalesce(NEW.acknowledged_by, auth.uid());
    NEW.acknowledged_at := coalesce(NEW.acknowledged_at, now());
  elsif OLD.status = 'issued' and NEW.status = 'cancelled' then
    if auth.uid() is not null and not (public.is_owner() or public.current_role() = 'manager') then
      raise exception 'only a manager or owner can cancel a gate pass';
    end if;
  else
    raise exception 'illegal gate pass transition: % → %', OLD.status, NEW.status using errcode = '22000';
  end if;
  return NEW;
end; $$;

create trigger t_gate_passes_transition
  before update on public.gate_passes
  for each row execute function public._gate_passes_transition();

create table public.gate_logs (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id),
  direction      text not null check (direction in ('in', 'out')),
  driver_name    text,
  driver_phone   text,
  bags           integer check (bags is null or bags >= 0),
  material_owner text,
  supplier_id    uuid references public.suppliers(id),
  reason         text,
  gate_pass_id   uuid references public.gate_passes(id),
  recorded_by    uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

create index gate_logs_site_idx on public.gate_logs (site_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.gate_passes enable row level security;
alter table public.gate_logs   enable row level security;

create policy "gate_passes: read own site or cross-site reporter"
  on public.gate_passes for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

create policy "gate_passes: manager/owner issue"
  on public.gate_passes for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

create policy "gate_passes: security ack / manager-owner cancel"
  on public.gate_passes for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() in ('security', 'manager') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() in ('security', 'manager') and site_id = public.current_site())
  );

create policy "gate_logs: read own site or cross-site reporter"
  on public.gate_logs for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

create policy "gate_logs: security records own site"
  on public.gate_logs for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'security' and site_id = public.current_site())
  );
