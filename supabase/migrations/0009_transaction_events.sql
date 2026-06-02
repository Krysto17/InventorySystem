-- Helper: return only the keys that changed between two JSONB blobs.
create or replace function public.jsonb_diff_changed(old jsonb, new jsonb)
  returns jsonb
  language sql
  immutable
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old->k, 'new', new->k)), '{}'::jsonb)
  from jsonb_object_keys(coalesce(new, '{}'::jsonb)) k
  where (old->k) is distinct from (new->k);
$$;

-- Audit log table. Insert is restricted to triggers (SECURITY DEFINER).
create table public.transaction_events (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null,  -- FK added in migration 0010 after visits exists
  event_type  text not null check (event_type in (
                'visit_created','state_changed','record_created','record_edited',
                'gate_exit_authorized','gate_released','owner_override')),
  actor_id    uuid references public.profiles(id),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index transaction_events_visit_idx on public.transaction_events (visit_id, created_at);

alter table public.transaction_events enable row level security;

-- Read: owner-only for now; per-site read policy added in 0010 after visits exists
create policy "transaction_events: owner reads all"
  on public.transaction_events
  for select to authenticated
  using (public.is_owner());

-- No client INSERT/UPDATE/DELETE policies — all DML denied by default.
-- Triggers will be SECURITY DEFINER so they can insert despite RLS.
