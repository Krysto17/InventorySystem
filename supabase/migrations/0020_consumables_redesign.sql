-- ─── Phase 9 (G): Consumables redesign ──────────────────────────────────────
-- Replaces the on-hand quantity model (Phase 4) with a categorized expense log.
-- Each consumables row is now one logged purchase/expense: name, category,
-- date, and a comment. The quantity ledger (on_hand/unit + consumable_movements)
-- is dropped — the owner wants a categorized record, not a stock counter.

drop trigger if exists t_consumable_movements_after on public.consumable_movements;
drop table if exists public.consumable_movements cascade;
drop function if exists public._consumable_movements_after();

alter table public.consumables drop constraint if exists consumables_site_id_name_key;
alter table public.consumables drop column if exists on_hand;
alter table public.consumables drop column if exists unit;

alter table public.consumables
  add column category text not null default 'others'
    check (category in (
      'fuel_lubricants', 'utility', 'wages', 'repairs_maintenance',
      'stationaries', 'transport', 'toiletries', 'others')),
  add column entry_date  date not null default current_date,
  add column comment     text,
  add column recorded_by uuid references public.profiles(id);

-- New rows must state their category explicitly (the table is empty here).
alter table public.consumables alter column category drop default;

create index consumables_site_category_idx on public.consumables (site_id, category, entry_date);

-- RLS from 0016 (read own site; inventory+owner insert/update on own site) is
-- unchanged and still applies to the reshaped table.
