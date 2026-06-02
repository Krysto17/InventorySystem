-- ─── bulk_sales ──────────────────────────────────────────────────────────────
-- Created before stock_movements so stock_movements can FK into it.
create table public.bulk_sales (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id),
  buyer_name       text not null,
  buyer_phone      text,
  material_type_id uuid not null references public.material_types(id),
  grade            text,
  weight           numeric(12,3) not null check (weight > 0),
  unit_price       numeric(12,2) not null check (unit_price > 0),
  total            numeric(14,2) generated always as (weight * unit_price) stored,
  sold_at          timestamptz not null default now(),
  recorded_by      uuid references public.profiles(id),
  approval_status  text not null default 'pending'
                     check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  rejection_note   text,
  received_amount  numeric(14,2),
  created_at       timestamptz not null default now()
);

create index bulk_sales_site_status_idx on public.bulk_sales (site_id, approval_status);

-- ─── stock_movements ─────────────────────────────────────────────────────────
create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id),
  material_type_id uuid not null references public.material_types(id),
  grade            text,
  weight           numeric(12,3) not null check (weight > 0),
  direction        text not null check (direction in ('in', 'out')),
  recorded_by      uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  reason           text not null check (reason in ('purchase_intake', 'bulk_sale', 'adjustment')),
  ref_visit_id     uuid references public.visits(id),
  ref_bulk_sale_id uuid references public.bulk_sales(id)
);

create index stock_movements_site_material_idx
  on public.stock_movements (site_id, material_type_id, grade);
create index stock_movements_visit_idx
  on public.stock_movements (ref_visit_id)
  where ref_visit_id is not null;

-- ─── consumables ─────────────────────────────────────────────────────────────
create table public.consumables (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id),
  name       text not null,
  on_hand    numeric(12,3) not null default 0,
  unit       text,
  created_at timestamptz not null default now(),
  unique (site_id, name)
);

-- ─── consumable_movements ────────────────────────────────────────────────────
create table public.consumable_movements (
  id            uuid primary key default gen_random_uuid(),
  consumable_id uuid not null references public.consumables(id) on delete cascade,
  delta         numeric(12,3) not null,
  recorded_by   uuid references public.profiles(id),
  reason        text,
  created_at    timestamptz not null default now()
);

create index consumable_movements_consumable_idx
  on public.consumable_movements (consumable_id);

-- ─── Stock-balance invariant ─────────────────────────────────────────────────
-- Blocks an 'out' movement from exceeding current stock for (site, material, grade).
create or replace function public._stock_movements_balance_check()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  current_balance numeric;
begin
  if NEW.direction = 'out' then
    select coalesce(
      sum(case when direction = 'in' then weight else -weight end), 0
    )
      into current_balance
      from public.stock_movements
     where site_id          = NEW.site_id
       and material_type_id = NEW.material_type_id
       and coalesce(grade, '') = coalesce(NEW.grade, '');

    if NEW.weight > current_balance then
      raise exception 'insufficient stock: available %.3f kg, requested %.3f kg',
        current_balance, NEW.weight
        using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger t_stock_movements_balance_check
  before insert on public.stock_movements
  for each row execute function public._stock_movements_balance_check();

-- ─── stock_movements AFTER INSERT: transition visit + write audit ─────────────
create or replace function public._stock_movements_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Transition awaiting_stock_intake → stocked
  if NEW.reason = 'purchase_intake' and NEW.ref_visit_id is not null then
    update public.visits set state = 'stocked' where id = NEW.ref_visit_id;
  end if;

  -- Write audit event into transaction_events (only when tied to a visit)
  if NEW.ref_visit_id is not null then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.ref_visit_id,
      'record_created',
      NEW.recorded_by,
      jsonb_build_object(
        'table',     'stock_movements',
        'record_id', NEW.id,
        'direction', NEW.direction,
        'weight',    NEW.weight,
        'grade',     NEW.grade,
        'reason',    NEW.reason
      )
    );
  end if;

  return NEW;
end;
$$;

create trigger t_stock_movements_after
  after insert on public.stock_movements
  for each row execute function public._stock_movements_after();

-- ─── bulk_sales AFTER UPDATE: write stock 'out' row on approval ───────────────
create or replace function public._bulk_sales_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.approval_status = 'approved' and OLD.approval_status = 'pending' then
    insert into public.stock_movements (
      site_id, material_type_id, grade, weight,
      direction, recorded_by, reason, ref_bulk_sale_id
    )
    values (
      NEW.site_id, NEW.material_type_id, NEW.grade, NEW.weight,
      'out', NEW.approved_by, 'bulk_sale', NEW.id
    );
  end if;
  return NEW;
end;
$$;

create trigger t_bulk_sales_after
  after update of approval_status on public.bulk_sales
  for each row execute function public._bulk_sales_after();

-- ─── consumable_movements AFTER INSERT: maintain on_hand ─────────────────────
create or replace function public._consumable_movements_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.consumables
     set on_hand = on_hand + NEW.delta
   where id = NEW.consumable_id;
  return NEW;
end;
$$;

create trigger t_consumable_movements_after
  after insert on public.consumable_movements
  for each row execute function public._consumable_movements_after();

-- ─── RLS: bulk_sales ─────────────────────────────────────────────────────────
alter table public.bulk_sales enable row level security;

create policy "bulk_sales: read own site"
  on public.bulk_sales for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

create policy "bulk_sales: inventory inserts on own site"
  on public.bulk_sales for insert to authenticated
  with check (
    (public.current_role() = 'inventory' and site_id = public.current_site())
    or public.is_owner()
  );

create policy "bulk_sales: owner updates"
  on public.bulk_sales for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ─── RLS: stock_movements ────────────────────────────────────────────────────
alter table public.stock_movements enable row level security;

create policy "stock_movements: read own site"
  on public.stock_movements for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Inventory inserts purchase_intake on own site; owner inserts anything on any site
-- (bulk_sale inserts are written by SECURITY DEFINER trigger, bypassing RLS)
create policy "stock_movements: inventory inserts on own site"
  on public.stock_movements for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'inventory'
      and site_id = public.current_site()
      and reason = 'purchase_intake'
    )
  );

-- ─── RLS: consumables ────────────────────────────────────────────────────────
alter table public.consumables enable row level security;

create policy "consumables: read own site"
  on public.consumables for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

create policy "consumables: inventory + owner insert"
  on public.consumables for insert to authenticated
  with check (
    (public.current_role() = 'inventory' and site_id = public.current_site())
    or public.is_owner()
  );

create policy "consumables: inventory + owner update on own site"
  on public.consumables for update to authenticated
  using (
    (public.current_role() = 'inventory' and site_id = public.current_site())
    or public.is_owner()
  )
  with check (
    (public.current_role() = 'inventory' and site_id = public.current_site())
    or public.is_owner()
  );

-- ─── RLS: consumable_movements ───────────────────────────────────────────────
alter table public.consumable_movements enable row level security;

create policy "consumable_movements: read own site"
  on public.consumable_movements for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.consumables c
      where c.id = consumable_movements.consumable_id
        and c.site_id = public.current_site()
    )
  );

create policy "consumable_movements: inventory + owner insert"
  on public.consumable_movements for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'inventory'
      and exists (
        select 1 from public.consumables c
        where c.id = consumable_movements.consumable_id
          and c.site_id = public.current_site()
      )
    )
  );
