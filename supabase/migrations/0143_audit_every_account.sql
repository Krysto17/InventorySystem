-- ─── The audit trail covers every account, not just the visit workflow ──────
-- Two defects, both structural.
--
-- 1. transaction_events.visit_id was NOT NULL, so only work attached to a visit
--    could be recorded at all. Everything else an account does — logging an
--    expense, approving an advance, paying a settlement, editing a supplier's
--    bank details, provisioning a user, counting the store, raising a gate pass
--    — had nowhere to go. The inventory officer's entire job is off-visit, so
--    their account shows no history whatsoever.
--
-- 2. The visit foreign key cascaded on delete, so removing a batch destroyed
--    its audit trail along with it. Deleting a mistaken batch is exactly the
--    moment the record of who did what matters most, and it was the moment the
--    record disappeared. The key now nulls instead: the event survives the visit
--    it described, carrying the entity it touched.

alter table public.transaction_events
  alter column visit_id drop not null,
  add column if not exists site_id   uuid references public.sites(id),
  add column if not exists entity    text,
  add column if not exists entity_id uuid;

comment on column public.transaction_events.entity is
  'The table the event is about. Set for off-visit work; visit events carry it in the payload.';

alter table public.transaction_events
  drop constraint if exists transaction_events_visit_id_fkey;
alter table public.transaction_events
  add constraint transaction_events_visit_id_fkey
  foreign key (visit_id) references public.visits(id) on delete set null;

alter table public.transaction_events drop constraint if exists transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check
  check (event_type in (
    'visit_created', 'state_changed', 'record_created', 'record_edited',
    'record_deleted', 'gate_exit_authorized', 'gate_released', 'owner_override'
  ));

-- Answering "what has this account done" is the point of the thing.
create index if not exists transaction_events_actor_idx
  on public.transaction_events (actor_id, created_at desc);
create index if not exists transaction_events_entity_idx
  on public.transaction_events (entity, entity_id);

-- ── One generic trigger for the tables that were never audited ──────────────
-- Deliberately generic: the next table someone adds gets an audit trail by
-- being named in the list below, rather than by remembering to hand-write a
-- trigger that logs the right shape.
create or replace function public._audit_row()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb; v_old jsonb; v_diff jsonb; v_site uuid; v_visit uuid; v_type text;
begin
  if TG_OP = 'DELETE' then
    v_row := to_jsonb(OLD); v_type := 'record_deleted';
  else
    v_row := to_jsonb(NEW); v_type := case when TG_OP = 'INSERT' then 'record_created' else 'record_edited' end;
  end if;

  if TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_diff := public.jsonb_diff_changed(v_old, v_row);
    -- Same rule as the visit log: an update that changed nothing is not history.
    if v_diff = '{}'::jsonb then return NEW; end if;
  end if;

  begin v_site := (v_row->>'site_id')::uuid; exception when others then v_site := null; end;
  begin v_visit := (v_row->>'visit_id')::uuid; exception when others then v_visit := null; end;

  insert into public.transaction_events
    (visit_id, site_id, entity, entity_id, event_type, actor_id, payload)
  values (
    v_visit, v_site, TG_TABLE_NAME, (v_row->>'id')::uuid, v_type, auth.uid(),
    case
      when TG_OP = 'UPDATE' then jsonb_build_object('table', TG_TABLE_NAME, 'record_id', v_row->>'id', 'diff', v_diff)
      else jsonb_build_object('table', TG_TABLE_NAME, 'record_id', v_row->>'id')
    end
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end; $$;

do $$
declare t text;
begin
  foreach t in array array[
    -- money an account moves
    'consumables', 'advances', 'advance_shares', 'settlement_payments',
    'settlement_payout_splits', 'price_corrections', 'cost_price_runs',
    -- stock an account moves or vouches for
    'stock_confirmations', 'bulk_sales', 'lot_sales', 'stock_lots',
    -- who the company deals with, and who can log in
    'suppliers', 'gate_passes', 'profiles'
  ]
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists t_audit_row on public.%I', t);
    execute format(
      'create trigger t_audit_row after insert or update or delete on public.%I '
      'for each row execute function public._audit_row()', t);
  end loop;
end $$;

-- ── Who may read it ─────────────────────────────────────────────────────────
-- Owner sees everything. A site-scoped role sees their own site's events,
-- whether the event hangs off a visit or off a site directly. An event tied to
-- neither (a user being provisioned, say) is the owner's alone.
drop policy if exists "transaction_events: read by visit visibility" on public.transaction_events;
create policy "transaction_events: read by visit visibility"
  on public.transaction_events for select to authenticated
  using (
    public.is_owner()
    or public.has_cross_site_read()
    or site_id = public.current_site()
    or exists (
      select 1 from public.visits v
       where v.id = transaction_events.visit_id and v.site_id = public.current_site()
    )
  );

-- ── The trail, flattened for reading ────────────────────────────────────────
drop view if exists public.audit_trail;
create view public.audit_trail with (security_invoker = on) as
  select te.id,
         te.created_at,
         te.event_type,
         coalesce(te.entity, te.payload->>'table', 'visit') as entity,
         coalesce(te.entity_id, (te.payload->>'record_id')::uuid) as entity_id,
         te.visit_id,
         te.site_id,
         s.name as site_name,
         te.actor_id,
         p.username    as actor_username,
         p.full_name   as actor_name,
         p.role::text  as actor_role,
         te.payload
    from public.transaction_events te
    left join public.profiles p on p.id = te.actor_id
    left join public.sites s    on s.id = te.site_id;

comment on view public.audit_trail is
  'Every recorded action with the account that took it. Runs as the caller.';

grant select on public.audit_trail to authenticated;

-- Per-account totals for the audit screen: one row per account instead of
-- counting the whole log in the page.
create or replace function public.audit_counts_by_actor()
returns table (actor_id uuid, events bigint, last_seen timestamptz)
language sql stable security invoker set search_path = public as $$
  select te.actor_id, count(*)::bigint, max(te.created_at)
    from public.transaction_events te
   where te.actor_id is not null
   group by te.actor_id;
$$;

grant execute on function public.audit_counts_by_actor() to authenticated;
