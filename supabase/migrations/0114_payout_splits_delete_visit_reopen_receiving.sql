-- ─── Three operational gaps ─────────────────────────────────────────────────
-- A. The MANAGER declares how a payout is split across accounts (exact figure
--    per account) on the batch settlement; the accountant sees that plan and
--    pays against it.
-- B. Processing / receiving can delete a visit they created while it is still
--    in their own stage (a mistaken entry), instead of only owner/GM.
-- C. Receiving can reopen a submitted batch to add / correct a material line and
--    send it to QC again for chemical analysis.

-- ── A. Payout split plan ────────────────────────────────────────────────────
create table public.settlement_payout_splits (
  id             uuid primary key default gen_random_uuid(),
  settlement_id  uuid not null references public.batch_settlements(id) on delete cascade,
  site_id        uuid not null references public.sites(id),
  account_name   text not null,
  account_number text not null,
  bank_name      text not null,
  amount         numeric(14,2) not null check (amount > 0),
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index settlement_payout_splits_settlement_idx
  on public.settlement_payout_splits(settlement_id, created_at);

alter table public.settlement_payout_splits enable row level security;

-- Everyone in the money lane reads the plan (the accountant pays against it).
create policy "payout_splits: finance roles read"
  on public.settlement_payout_splits for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- The manager (own site) / owner maintain the plan while it isn't paid out.
create policy "payout_splits: manager/owner write"
  on public.settlement_payout_splits for insert to authenticated
  with check (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );
create policy "payout_splits: manager/owner update"
  on public.settlement_payout_splits for update to authenticated
  using (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  )
  with check (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );
create policy "payout_splits: manager/owner delete"
  on public.settlement_payout_splits for delete to authenticated
  using (
    public.is_owner() or public.is_general_manager()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

-- Account details must be complete, and the plan may never exceed the payout.
create trigger t_payout_splits_complete_account
  before insert or update on public.settlement_payout_splits
  for each row execute function public._require_complete_account();

create or replace function public._payout_splits_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_planned numeric; v_status text;
begin
  select net_balance, status into v_net, v_status
    from public.batch_settlements where id = NEW.settlement_id;
  if v_net is null then raise exception 'settlement not found'; end if;
  if v_status = 'paid' then raise exception 'this settlement is already paid'; end if;

  select coalesce(sum(amount), 0) into v_planned
    from public.settlement_payout_splits
    where settlement_id = NEW.settlement_id and id <> NEW.id;

  if v_planned + NEW.amount > v_net + 0.005 then
    raise exception 'split total %.2f exceeds the payout of %.2f',
      v_planned + NEW.amount, v_net using errcode = '23514';
  end if;
  return NEW;
end; $$;

create trigger t_payout_splits_guard
  before insert or update on public.settlement_payout_splits
  for each row execute function public._payout_splits_guard();

-- ── B. Processing / receiving delete their own in-stage visit ───────────────
create or replace function public.delete_batch(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_settle_status text; v_state text; v_site uuid; v_role text;
begin
  select state, site_id into v_state, v_site from public.visits where id = p_visit_id;
  if v_state is null then raise exception 'visit not found'; end if;

  select status into v_settle_status
    from public.batch_settlements where visit_id = p_visit_id;
  v_role := public.current_role();

  if public.is_owner() then
    if v_settle_status = 'paid' then
      raise exception 'cannot delete a batch that has been paid';
    end if;
  elsif public.is_general_manager() then
    if v_settle_status in ('approved', 'paid') then
      raise exception 'cannot delete a batch the owner has already approved';
    end if;
  elsif v_role = 'processing' and v_site = public.current_site() then
    -- Only a mistaken entry still sitting in processing.
    if v_state <> 'in_processing' then
      raise exception 'processing can only delete a visit still in processing';
    end if;
  elsif v_role = 'receiving' and v_site = public.current_site() then
    if v_state not in ('in_processing', 'in_receiving') then
      raise exception 'receiving can only delete a visit still in receiving';
    end if;
  else
    raise exception 'not authorized to delete batches';
  end if;

  delete from public.visits where id = p_visit_id;
end; $$;

-- ── C. Receiving reopens a submitted batch to add / correct lines ───────────
-- Adds the in_qc → in_receiving edge, then submit_visit_to_manager sends it to
-- QC again. Blocked once pricing has acted on the batch.
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean; has_analysis boolean; has_submitted_xrf boolean;
  has_lines boolean; all_exempt boolean; has_authorization boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;
  is_legal := (OLD.state, NEW.state) in (
    ('in_processing','in_receiving'), ('in_receiving','awaiting_manager'),
    ('in_receiving','in_qc'), ('in_receiving','pricing'), ('in_receiving','exited'),
    ('awaiting_manager','in_qc'), ('awaiting_manager','pricing'), ('in_qc','pricing'),
    ('in_qc','in_receiving'),
    ('pricing','awaiting_price_approval'), ('awaiting_price_approval','in_accounting'),
    ('awaiting_price_approval','pricing'), ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'), ('pricing','exited'), ('pricing','stocked'),
    ('awaiting_gate_exit','exited'), ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','awaiting_price_approval'), ('in_accounting','pricing'),
    ('in_accounting','stocked'), ('awaiting_stock_intake','stocked'),
    ('stocked','pricing')
  );
  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state using errcode = '22000';
  end if;
  if NEW.state in ('awaiting_manager','in_qc') then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot advance without material lines'; end if;
  end if;
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (select 1 from public.visit_materials vm join public.xrf_records x on x.visit_material_id = vm.id
                   where vm.visit_id = NEW.id and x.submitted) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis) into all_exempt;
    if OLD.state not in ('awaiting_price_approval','in_accounting','stocked')
       and not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;
  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id) into has_authorization;
    if not has_authorization then raise exception 'cannot release without a gate exit authorization'; end if;
  end if;
  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;
  return NEW;
end; $$;

create or replace function public.reopen_receiving(p_visit_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_state text;
begin
  select site_id, state into v_site, v_state from public.visits where id = p_visit_id;
  if v_site is null then raise exception 'visit not found'; end if;
  if not (public.is_owner() or public.is_general_manager()
          or (public.current_role() in ('receiving', 'manager') and v_site = public.current_site())) then
    raise exception 'not authorized to reopen receiving on this visit';
  end if;
  if v_state <> 'in_qc' then
    raise exception 'only a batch waiting in QC can be reopened for receiving (state: %)', v_state;
  end if;
  update public.visits set state = 'in_receiving' where id = p_visit_id;
end; $$;

grant execute on function public.reopen_receiving(uuid) to authenticated;
