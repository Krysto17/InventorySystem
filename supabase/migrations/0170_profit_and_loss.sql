-- 0170 — Profit & loss: a salary figure, bulk sales by the manager, and the
--        statement formula in one place
--
-- The owner and the accountant need to ask "did we make money between these two
-- dates", and until now nothing could answer it: the numbers existed but lived
-- in six tables with no shared definition and no date-ranged roll-up.
--
-- Three parts.
--
-- 1. SALARIES. There is already a `wages` expense category on `consumables`,
--    but an expense row is one itemised purchase needing owner approval, and
--    payroll is a single monthly figure the accountant knows and simply needs
--    to enter. `salary_entries` holds exactly one figure per site per month —
--    `unique (site_id, period)` makes double entry impossible rather than
--    merely discouraged, which matters because a duplicated payroll line would
--    swing the statement by millions.
--
--    The statement EXCLUDES the `wages` expense category, so the same money can
--    never be counted twice, and it reports what is sitting in that category so
--    nobody is left wondering where it went.
--
-- 2. WHO RECORDS A BULK SALE. 0038 let the manager and inventory record sales;
--    0045 deliberately narrowed it to inventory. Sales are the revenue side of
--    this statement and the manager owns pricing, so this moves it back to the
--    manager — and off inventory, so there is one recorder rather than two.
--    Owner approval is unchanged and still the thing that makes a sale real.
--
-- 3. THE FORMULA. `profit_and_loss()` returns one row per site with every
--    component, so the statement can show its own arithmetic. It is SECURITY
--    INVOKER on purpose: RLS already scopes every table it reads, so the owner
--    and the (cross-site) accountant get all three sites while a site manager
--    would get only their own, with no new definer surface to audit.
--
-- MATERIAL COST IS REPORTED TWO WAYS, because the two answer different
-- questions and the business wants both:
--   materials_cash — money actually paid to suppliers in the window. Matches
--                    the bank. A month of heavy buying looks like a loss even
--                    though the stock is still in the yard.
--   materials_cogs — cost of just the material that was SOLD, valued at the
--                    weighted average cost of that material's lots at that
--                    site, counting only lots the company actually owned
--                    ('available', 'consumed' or 'sold'; a 'released' lot went
--                    back to the supplier). Truer trading profit. `bulk_sales` records a
--                    material type and a weight but not which lots it came
--                    from, so a weighted average is the honest basis available:
--                    exact when lots of one material share a cost, approximate
--                    when they do not. The statement says so on its face.

-- ─── 0. Do not assume the write-off column exists ───────────────────────────
-- The statement must not count a written-off debt as money collected, so it
-- filters on `advance_deductions.is_write_off`. That column comes from
-- 0118_debt_write_off — and there are TWO migrations numbered 0118, so the
-- ledger can only record one of them and the other is skipped. It is absent
-- from a freshly reset local database, which also means `figures.ts` errors on
-- that filter there. Re-asserting it is idempotent and makes this migration
-- self-sufficient wherever it is applied; it does not change 0118's meaning.
alter table public.advance_deductions
  add column if not exists is_write_off boolean not null default false;

-- ─── 1. Salaries ────────────────────────────────────────────────────────────
create table if not exists public.salary_entries (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites(id),
  -- Always the first day of the month the payroll covers, so one month cannot
  -- be entered twice under two different dates.
  period       date not null,
  amount_naira numeric(14,2) not null check (amount_naira >= 0),
  note         text,
  recorded_by  uuid references public.profiles(id),
  request_key  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint salary_entries_period_is_month_start
    check (period = date_trunc('month', period)::date),
  constraint salary_entries_one_per_site_month unique (site_id, period)
);

create index if not exists salary_entries_period_idx
  on public.salary_entries (period, site_id);
create unique index if not exists salary_entries_request_key_idx
  on public.salary_entries (request_key) where request_key is not null;

alter table public.salary_entries enable row level security;

-- The money lane reads it; the statement is for the owner and the accountant,
-- and the manager needs to see what they entered.
drop policy if exists "salary_entries: finance roles read" on public.salary_entries;
create policy "salary_entries: finance roles read"
  on public.salary_entries for select to authenticated
  using (site_id = public.current_site() or public.has_cross_site_read());

-- Accountant and manager enter it for their own site; the owner for any site.
drop policy if exists "salary_entries: accounting/manager write own site" on public.salary_entries;
create policy "salary_entries: accounting/manager write own site"
  on public.salary_entries for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() in ('accounting', 'manager') and site_id = public.current_site())
  );
drop policy if exists "salary_entries: accounting/manager correct own site" on public.salary_entries;
create policy "salary_entries: accounting/manager correct own site"
  on public.salary_entries for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() in ('accounting', 'manager') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() in ('accounting', 'manager') and site_id = public.current_site())
  );
drop policy if exists "salary_entries: owner deletes" on public.salary_entries;
create policy "salary_entries: owner deletes"
  on public.salary_entries for delete to authenticated
  using (public.is_owner());

drop trigger if exists t_audit_row on public.salary_entries;
create trigger t_audit_row
  after insert or update or delete on public.salary_entries
  for each row execute function public._audit_row();

create or replace function public._salary_entries_touch()
  returns trigger language plpgsql set search_path to 'public' as $function$
begin
  NEW.updated_at := now();
  return NEW;
end; $function$;

drop trigger if exists t_salary_entries_touch on public.salary_entries;
create trigger t_salary_entries_touch
  before update on public.salary_entries
  for each row execute function public._salary_entries_touch();

comment on table public.salary_entries is
  'One total payroll figure per site per month, entered by the accountant or '
  'manager. The profit-and-loss statement reads salary from here and excludes '
  'the `wages` expense category so nothing is counted twice. See 0170.';

-- ─── 2. The manager records bulk sales ──────────────────────────────────────
drop policy if exists "bulk_sales: inventory inserts on own site" on public.bulk_sales;
drop policy if exists "bulk_sales: inventory/manager inserts on own site" on public.bulk_sales;
drop policy if exists "bulk_sales: manager inserts on own site" on public.bulk_sales;
create policy "bulk_sales: manager inserts on own site"
  on public.bulk_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

-- A sale may be corrected by whoever recorded it until the owner has approved
-- it. After that it is the revenue side of a statement and only the owner may
-- touch it (the existing "bulk_sales: owner updates" policy still covers that).
drop policy if exists "bulk_sales: manager corrects before approval" on public.bulk_sales;
create policy "bulk_sales: manager corrects before approval"
  on public.bulk_sales for update to authenticated
  using (
    public.current_role() = 'manager'
    and site_id = public.current_site()
    and approval_status = 'pending'
  )
  with check (
    public.current_role() = 'manager'
    and site_id = public.current_site()
    and approval_status = 'pending'
  );

-- ─── 3. The statement ───────────────────────────────────────────────────────
create or replace function public.profit_and_loss(p_from date, p_to date)
  returns table (
    site_id            uuid,
    site_name          text,
    sales_total        numeric,  -- income: approved bulk sales, at sale value
    sales_received     numeric,  -- memo: how much of that has come in
    fees_collected     numeric,  -- income: processing fees / light bills collected
    materials_cash     numeric,  -- cost: paid to suppliers in the window
    materials_cogs     numeric,  -- cost: weighted-average cost of material sold
    expenses           numeric,  -- cost: approved expenses, excluding wages
    wages_in_expenses  numeric,  -- memo: wages-category rows deliberately excluded
    salaries           numeric,  -- cost: the entered payroll figure
    corrections        numeric   -- cost: under-priced supplies compensated
  )
  language sql
  stable
  set search_path to 'public'
as $function$
  with bounds as (
    select p_from::timestamptz                                as ts_from,
           (p_to + 1)::timestamptz                            as ts_to,  -- inclusive of p_to
           date_trunc('month', p_from)::date                  as m_from,
           date_trunc('month', p_to)::date                    as m_to
  ),
  -- Weighted average cost per material per site, over the lots on record. Used
  -- to value what was sold; see the header for why an average is the basis.
  avg_cost as (
    select sl.site_id, sl.material_type_id,
           sum(sl.weight_kg * sl.cost_price_per_kg) / nullif(sum(sl.weight_kg), 0) as per_kg
      from public.stock_lots sl
     where sl.cost_price_per_kg is not null and sl.weight_kg > 0
       -- 'released' lots went back to the supplier and were never really
       -- inventory, so they must not drag the cost basis up or down. What is
       -- left is what the company actually owned: still in the yard, consumed
       -- into a batch (0171), or sold.
       and sl.status in ('available', 'consumed', 'sold')
     group by sl.site_id, sl.material_type_id
  )
  select
    s.id as site_id,
    s.name as site_name,
    coalesce((select sum(b.total) from public.bulk_sales b, bounds
               where b.site_id = s.id and b.approval_status = 'approved'
                 and b.sold_at >= bounds.ts_from and b.sold_at < bounds.ts_to), 0),
    coalesce((select sum(coalesce(b.received_amount, 0)) from public.bulk_sales b, bounds
               where b.site_id = s.id and b.approval_status = 'approved'
                 and b.sold_at >= bounds.ts_from and b.sold_at < bounds.ts_to), 0),
    -- Processing fees reach the company three ways; figures.ts is the authority
    -- on which count as collected, and this mirrors it, date-ranged.
    coalesce((select sum(bs.light_bill_total) from public.batch_settlements bs, bounds
               where bs.site_id = s.id and bs.status = 'paid'
                 and bs.paid_at >= bounds.ts_from and bs.paid_at < bounds.ts_to), 0)
    + coalesce((select sum(uc.amount)
                  from public.utility_charges uc
                  join public.visits v on v.id = uc.visit_id, bounds
                 where v.site_id = s.id and uc.kind = 'light_bill' and uc.carried = false
                   and v.dressing_only = true
                   and uc.created_at >= bounds.ts_from and uc.created_at < bounds.ts_to), 0)
    + coalesce((select sum(ad.amount) from public.advance_deductions ad, bounds
                 where ad.site_id = s.id and ad.kind = 'processing' and ad.is_write_off = false
                   and ad.created_at >= bounds.ts_from and ad.created_at < bounds.ts_to), 0),
    -- Cash out to suppliers: the payment ledger, not the settlement total, so
    -- this is money that actually left in the window.
    coalesce((select sum(sp.amount) from public.settlement_payments sp, bounds
               where sp.site_id = s.id
                 and sp.created_at >= bounds.ts_from and sp.created_at < bounds.ts_to), 0),
    coalesce((select sum(b.weight * coalesce(ac.per_kg, 0))
                from public.bulk_sales b
                left join avg_cost ac
                  on ac.site_id = b.site_id and ac.material_type_id = b.material_type_id, bounds
               where b.site_id = s.id and b.approval_status = 'approved'
                 and b.sold_at >= bounds.ts_from and b.sold_at < bounds.ts_to), 0),
    coalesce((select sum(c.amount_naira) from public.consumables c, bounds
               where c.site_id = s.id and c.category <> 'wages'
                 and c.approval_status in ('approved', 'paid')
                 and c.entry_date >= p_from and c.entry_date <= p_to), 0),
    coalesce((select sum(c.amount_naira) from public.consumables c, bounds
               where c.site_id = s.id and c.category = 'wages'
                 and c.approval_status in ('approved', 'paid')
                 and c.entry_date >= p_from and c.entry_date <= p_to), 0),
    coalesce((select sum(se.amount_naira) from public.salary_entries se, bounds
               where se.site_id = s.id
                 and se.period >= bounds.m_from and se.period <= bounds.m_to), 0),
    coalesce((select sum(pc.amount) from public.price_corrections pc, bounds
               where pc.site_id = s.id and pc.direction = 'underpaid'
                 and pc.paid_at is not null
                 and pc.paid_at >= bounds.ts_from and pc.paid_at < bounds.ts_to), 0)
  from public.sites s
  order by s.name;
$function$;

comment on function public.profit_and_loss(date, date) is
  'One row per site with every component of the profit-and-loss statement for '
  'the window, so the statement can show its arithmetic. Material cost is '
  'reported both as cash paid to suppliers and as weighted-average cost of '
  'material sold. SECURITY INVOKER: RLS scopes the rows. See 0170.';

revoke execute on function public.profit_and_loss(date, date) from public, anon;
grant  execute on function public.profit_and_loss(date, date) to authenticated;
