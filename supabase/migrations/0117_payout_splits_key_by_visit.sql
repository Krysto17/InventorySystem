-- ─── Payout splits belong to the VISIT, not the settlement ──────────────────
-- Two defects in 0114:
--   1. Splits hung off batch_settlements, which only exists AFTER the owner
--      approves pricing — so the manager, who works at the pricing stage, never
--      saw the tool.
--   2. approve_pricing DELETEs and recreates the non-paid settlement, so the
--      cascade silently wiped the manager's plan on every (re)approval.
-- Keying to the visit fixes both: the plan can be made as soon as the batch is
-- priced and it survives approval / send-back / re-approval.

alter table public.settlement_payout_splits
  add column if not exists visit_id uuid references public.visits(id) on delete cascade;

-- Backfill from the settlement, then make the visit the key.
update public.settlement_payout_splits s
   set visit_id = bs.visit_id
  from public.batch_settlements bs
 where bs.id = s.settlement_id and s.visit_id is null;

delete from public.settlement_payout_splits where visit_id is null;
alter table public.settlement_payout_splits alter column visit_id set not null;
alter table public.settlement_payout_splits alter column settlement_id drop not null;

drop index if exists settlement_payout_splits_settlement_idx;
create index if not exists settlement_payout_splits_visit_idx
  on public.settlement_payout_splits(visit_id, created_at);

-- The payout to check against: the settlement snapshot once approved, otherwise
-- the live priced total.
create or replace function public._payout_splits_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_planned numeric; v_status text;
begin
  select bs.net_balance, bs.status into v_net, v_status
    from public.batch_settlements bs where bs.visit_id = NEW.visit_id;

  if v_status = 'paid' then
    raise exception 'this settlement is already paid';
  end if;

  -- No settlement yet (still pricing) → value the plan against the live total.
  if v_net is null then
    select t.net into v_net from public.settlement_totals(NEW.visit_id) t;
  end if;
  if coalesce(v_net, 0) <= 0 then
    raise exception 'price the batch before planning how the payout is split';
  end if;

  select coalesce(sum(amount), 0) into v_planned
    from public.settlement_payout_splits
    where visit_id = NEW.visit_id and id <> NEW.id;

  if v_planned + NEW.amount > v_net + 0.005 then
    raise exception 'split total %.2f exceeds the payout of %.2f',
      v_planned + NEW.amount, v_net using errcode = '23514';
  end if;
  return NEW;
end; $$;
