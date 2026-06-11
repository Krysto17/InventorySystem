-- ─── Phase 9 (H): Lot-tracked bulk sales ─────────────────────────────────────
-- Each purchase intake becomes an identifiable stock LOT (supplier + material +
-- weight + cost price). A lot sale selects available lots of one material; on
-- owner approval the lots flip to SOLD (irreversibly, DB-enforced) and the sale
-- snapshots total weight, total cost price, and average cost price per kg —
-- exactly the breakdown in the owner's spec. This is additive: the Phase-4
-- fungible bulk_sales/stock_movements model is left intact.

-- ─── stock_lots ──────────────────────────────────────────────────────────────
create table public.stock_lots (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references public.sites(id),
  material_type_id      uuid not null references public.material_types(id),
  supplier_id           uuid references public.suppliers(id),
  ref_visit_material_id uuid references public.visit_materials(id),
  weight_kg             numeric(12,3) not null check (weight_kg > 0),
  cost_price_per_kg     numeric(12,2) check (cost_price_per_kg >= 0),
  status                text not null default 'available' check (status in ('available','sold')),
  recorded_by           uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

create index stock_lots_site_material_status_idx
  on public.stock_lots (site_id, material_type_id, status);

-- ─── lot_sales + lot_sale_items ──────────────────────────────────────────────
create table public.lot_sales (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references public.sites(id),
  material_type_id      uuid not null references public.material_types(id),
  buyer_name            text not null,
  buyer_phone           text,
  approval_status       text not null default 'pending'
                          check (approval_status in ('pending','approved','rejected')),
  approved_by           uuid references public.profiles(id),
  approved_at           timestamptz,
  rejection_note        text,
  total_weight_kg       numeric(12,3),   -- snapshotted on approval
  total_cost_price      numeric(14,2),
  avg_cost_price_per_kg numeric(12,2),
  recorded_by           uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);

create index lot_sales_site_status_idx on public.lot_sales (site_id, approval_status);

create table public.lot_sale_items (
  lot_sale_id  uuid not null references public.lot_sales(id) on delete cascade,
  stock_lot_id uuid not null references public.stock_lots(id),
  primary key (lot_sale_id, stock_lot_id)
);

-- ─── Guard: a lot may be added only if available, same site+material, and not
--           already attached to a non-rejected sale ────────────────────────────
create or replace function public._lot_sale_items_before_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  lot record;
  sale record;
  dupes int;
begin
  select * into lot from public.stock_lots where id = NEW.stock_lot_id;
  if lot is null then raise exception 'stock lot not found'; end if;
  if lot.status <> 'available' then
    raise exception 'stock lot % is already sold', NEW.stock_lot_id;
  end if;

  select * into sale from public.lot_sales where id = NEW.lot_sale_id;
  if sale.material_type_id <> lot.material_type_id then
    raise exception 'lot material does not match the sale material';
  end if;
  if sale.site_id <> lot.site_id then
    raise exception 'lot site does not match the sale site';
  end if;

  select count(*) into dupes
    from public.lot_sale_items i
    join public.lot_sales s on s.id = i.lot_sale_id
   where i.stock_lot_id = NEW.stock_lot_id
     and s.approval_status in ('pending','approved');
  if dupes > 0 then
    raise exception 'stock lot % is already in another active sale', NEW.stock_lot_id;
  end if;

  return NEW;
end;
$$;

create trigger t_lot_sale_items_before_insert
  before insert on public.lot_sale_items
  for each row execute function public._lot_sale_items_before_insert();

-- ─── Approval: flip lots to SOLD + snapshot the cost breakdown ───────────────
create or replace function public._lot_sales_after_approval()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  sold int;
  n_items int;
  tot_w numeric;
  tot_c numeric;
begin
  if NEW.approval_status = 'approved' and OLD.approval_status = 'pending' then
    select count(*) into n_items from public.lot_sale_items where lot_sale_id = NEW.id;
    if n_items = 0 then
      raise exception 'cannot approve a sale with no lots';
    end if;

    -- Mark every selected lot sold (only if still available).
    with marked as (
      update public.stock_lots l
         set status = 'sold'
        from public.lot_sale_items i
       where i.lot_sale_id = NEW.id
         and i.stock_lot_id = l.id
         and l.status = 'available'
      returning l.id
    )
    select count(*) into sold from marked;
    if sold <> n_items then
      raise exception 'one or more lots were no longer available';
    end if;

    -- Snapshot totals + average cost price per kg.
    select coalesce(sum(l.weight_kg), 0),
           coalesce(sum(l.weight_kg * coalesce(l.cost_price_per_kg, 0)), 0)
      into tot_w, tot_c
      from public.lot_sale_items i
      join public.stock_lots l on l.id = i.stock_lot_id
     where i.lot_sale_id = NEW.id;

    update public.lot_sales
       set total_weight_kg       = tot_w,
           total_cost_price      = tot_c,
           avg_cost_price_per_kg = case when tot_w > 0 then round(tot_c / tot_w, 2) else null end,
           approved_by           = coalesce(NEW.approved_by, auth.uid()),
           approved_at           = coalesce(NEW.approved_at, now())
     where id = NEW.id;
  end if;
  return NEW;
end;
$$;

create trigger t_lot_sales_after_approval
  after update of approval_status on public.lot_sales
  for each row execute function public._lot_sales_after_approval();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.stock_lots     enable row level security;
alter table public.lot_sales       enable row level security;
alter table public.lot_sale_items  enable row level security;

-- stock_lots: read own site; inventory creates on own site; owner full.
create policy "stock_lots: read own site"
  on public.stock_lots for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

create policy "stock_lots: inventory inserts own site"
  on public.stock_lots for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

-- Direct status edits are owner-only (sales flip lots via SECURITY DEFINER).
create policy "stock_lots: owner updates"
  on public.stock_lots for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- lot_sales: read own site; inventory creates pending; OWNER approves.
create policy "lot_sales: read own site"
  on public.lot_sales for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

create policy "lot_sales: inventory inserts own site"
  on public.lot_sales for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'inventory' and site_id = public.current_site())
  );

create policy "lot_sales: owner updates"
  on public.lot_sales for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- lot_sale_items: read via sale visibility; inventory adds while sale pending.
create policy "lot_sale_items: read own site"
  on public.lot_sale_items for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.lot_sales s
               where s.id = lot_sale_items.lot_sale_id and s.site_id = public.current_site())
  );

create policy "lot_sale_items: inventory inserts on pending own-site sale"
  on public.lot_sale_items for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'inventory'
      and exists (select 1 from public.lot_sales s
                  where s.id = lot_sale_items.lot_sale_id
                    and s.site_id = public.current_site()
                    and s.approval_status = 'pending')
    )
  );
