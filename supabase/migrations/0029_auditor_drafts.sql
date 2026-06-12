-- ─── Phase 10 (B): Auditor draft chain ───────────────────────────────────────
-- The auditor performs manager-level tasks, but nothing takes effect until a
-- manager (or the owner) approves it: Auditor → Manager → Owner. Drafts are
-- generic rows whose payload is applied by a SECURITY DEFINER trigger on
-- approval:
--   • line_price : sets visit_materials.unit_price (the manager task from P9)
--   • advance    : inserts an advances row (still pending the normal advance
--                  approval — the blueprint sends advances to the director)
--   • expense    : inserts a consumables (categorized expense) row
-- An auditor can create, edit (while draft), and submit; they can never
-- approve — not even their own draft.

create table public.auditor_drafts (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id),
  kind          text not null check (kind in ('line_price', 'advance', 'expense')),
  payload       jsonb not null,
  review_status text not null default 'draft'
                  check (review_status in ('draft', 'submitted', 'approved', 'rejected')),
  review_note   text,
  created_by    uuid not null references public.profiles(id),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index auditor_drafts_site_status_idx on public.auditor_drafts (site_id, review_status);

-- ─── Transition rules ────────────────────────────────────────────────────────
create or replace function public._auditor_drafts_before_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Terminal states are immutable.
  if OLD.review_status in ('approved', 'rejected') then
    raise exception 'draft is finalized and can no longer change';
  end if;

  -- Content edits only while still a draft.
  if (NEW.payload is distinct from OLD.payload or NEW.kind is distinct from OLD.kind)
     and OLD.review_status <> 'draft' then
    raise exception 'submitted drafts cannot be edited';
  end if;

  if NEW.review_status is distinct from OLD.review_status then
    if OLD.review_status = 'draft' and NEW.review_status = 'submitted' then
      if auth.uid() <> OLD.created_by and not public.is_owner() then
        raise exception 'only the draft author can submit it';
      end if;
    elsif OLD.review_status = 'submitted' and NEW.review_status in ('approved', 'rejected') then
      if not (public.is_owner() or public.current_role() = 'manager') then
        raise exception 'only a manager or the owner can review a draft';
      end if;
      if auth.uid() = OLD.created_by then
        raise exception 'a draft cannot be reviewed by its author';
      end if;
      NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
      NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
    else
      raise exception 'illegal review transition: % → %', OLD.review_status, NEW.review_status;
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger t_auditor_drafts_before_update
  before update on public.auditor_drafts
  for each row execute function public._auditor_drafts_before_update();

-- ─── Apply on approval ───────────────────────────────────────────────────────
create or replace function public._auditor_drafts_apply()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if NEW.review_status = 'approved' and OLD.review_status = 'submitted' then
    if NEW.kind = 'line_price' then
      if NEW.payload->>'visit_material_id' is null or NEW.payload->>'unit_price' is null then
        raise exception 'line_price draft needs visit_material_id and unit_price';
      end if;
      update public.visit_materials
         set unit_price = (NEW.payload->>'unit_price')::numeric,
             priced_by  = NEW.reviewed_by
       where id = (NEW.payload->>'visit_material_id')::uuid;

    elsif NEW.kind = 'advance' then
      if NEW.payload->>'supplier_id' is null or NEW.payload->>'purpose' is null
         or NEW.payload->>'amount_naira' is null then
        raise exception 'advance draft needs supplier_id, purpose, amount_naira';
      end if;
      insert into public.advances (supplier_id, site_id, purpose, amount_naira, comment, recorded_by)
      values (
        (NEW.payload->>'supplier_id')::uuid,
        NEW.site_id,
        NEW.payload->>'purpose',
        (NEW.payload->>'amount_naira')::numeric,
        NEW.payload->>'comment',
        NEW.created_by
      );

    elsif NEW.kind = 'expense' then
      if NEW.payload->>'name' is null or NEW.payload->>'category' is null then
        raise exception 'expense draft needs name and category';
      end if;
      insert into public.consumables (site_id, name, category, entry_date, comment, recorded_by)
      values (
        NEW.site_id,
        NEW.payload->>'name',
        NEW.payload->>'category',
        coalesce((NEW.payload->>'entry_date')::date, current_date),
        NEW.payload->>'comment',
        NEW.created_by
      );
    end if;
  end if;
  return NEW;
end;
$$;

create trigger t_auditor_drafts_apply
  after update of review_status on public.auditor_drafts
  for each row execute function public._auditor_drafts_apply();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.auditor_drafts enable row level security;

create policy "auditor_drafts: author + manager + owner read"
  on public.auditor_drafts for select to authenticated
  using (
    public.is_owner()
    or created_by = auth.uid()
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );

create policy "auditor_drafts: auditor inserts own site"
  on public.auditor_drafts for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'auditor'
      and site_id = public.current_site()
      and created_by = auth.uid()
    )
  );

create policy "auditor_drafts: author edits, manager reviews"
  on public.auditor_drafts for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() = 'auditor' and created_by = auth.uid())
    or (public.current_role() = 'manager' and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() = 'auditor' and created_by = auth.uid())
    or (public.current_role() = 'manager' and site_id = public.current_site())
  );
