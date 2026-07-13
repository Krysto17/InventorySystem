-- ─── Batch comments (manager note on a supply, for owner + accountant) ───────
-- The manager can leave a note on a batch/supply — context the owner sees when
-- approving and the accountant sees before paying. Append-only log.

create table public.batch_comments (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references public.visits(id) on delete cascade,
  site_id    uuid not null references public.sites(id),
  body       text not null check (length(btrim(body)) > 0),
  author     uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index batch_comments_visit_idx on public.batch_comments(visit_id, created_at);

alter table public.batch_comments enable row level security;

-- Read: manager / accounting / owner. Owner + accounting (cross-site read) see
-- all; a site manager sees their own site's.
create policy "batch_comments: read for manager/accounting/owner"
  on public.batch_comments for select to authenticated
  using (
    public.current_role() in ('manager', 'accounting', 'owner')
    and (site_id = public.current_site() or public.has_cross_site_read())
  );

-- Write: the owner, or a manager on their own site (the general manager any site).
create policy "batch_comments: manager/owner insert"
  on public.batch_comments for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'manager'
        and (site_id = public.current_site() or public.is_general_manager()))
  );
