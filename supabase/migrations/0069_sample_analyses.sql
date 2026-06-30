-- ─── Standalone sample analyses (QC) ─────────────────────────────────────────
-- QC can analyse a walk-in sample without a visit/batch: supplier name + result
-- (+ optional material & weight). Every row here IS a sample. The owner and the
-- general manager can attach a flat price. QC reads/edits its own site's samples
-- (until priced); owner + GM read all and price.

create table public.sample_analyses (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id),
  supplier_id      uuid references public.suppliers(id),
  supplier_name    text not null,
  material_type_id uuid references public.material_types(id),
  weight_kg        numeric(12,3) check (weight_kg is null or weight_kg >= 0),
  result           text not null,
  price            numeric(14,2) check (price is null or price >= 0),
  priced_by        uuid references public.profiles(id),
  recorded_by      uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index sample_analyses_site_idx on public.sample_analyses (site_id);

create trigger t_sample_analyses_touch
  before update on public.sample_analyses
  for each row execute function public._touch_updated_at();

alter table public.sample_analyses enable row level security;

create policy "sample_analyses: qc inserts on own site"
  on public.sample_analyses for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'qc' and site_id = public.current_site())
  );

create policy "sample_analyses: read own site, owner or GM"
  on public.sample_analyses for select to authenticated
  using (
    public.is_owner()
    or public.is_general_manager()
    or (public.current_role() in ('qc', 'manager') and site_id = public.current_site())
  );

-- Owner + GM may price any sample; QC may edit its own sample until it's priced.
create policy "sample_analyses: owner/GM price, qc edits own unpriced"
  on public.sample_analyses for update to authenticated
  using (
    public.is_owner()
    or public.is_general_manager()
    or (public.current_role() = 'qc' and recorded_by = auth.uid() and price is null)
  )
  with check (
    public.is_owner()
    or public.is_general_manager()
    or (public.current_role() = 'qc' and recorded_by = auth.uid())
  );

create policy "sample_analyses: delete by owner or qc own unpriced"
  on public.sample_analyses for delete to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'qc' and recorded_by = auth.uid() and price is null)
  );
