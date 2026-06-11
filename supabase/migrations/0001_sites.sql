create extension if not exists "pgcrypto";

-- ─── Base table grants (local Supabase image compatibility) ──────────────────
-- The app and its RLS tests assume the anon/authenticated/service_role roles
-- receive full table privileges by default, with `profiles` and `visits` later
-- narrowed via REVOKE + column GRANT. Some Supabase CLI / Postgres-17 image
-- versions set the `postgres` role's default privileges in `public` to grant
-- only Dxtm (no SELECT/INSERT/UPDATE/DELETE) to those roles, which breaks every
-- query (service_role can't even read `sites`). Restore the expected default so
-- every table the migration runner creates below is reachable. RLS remains the
-- security boundary; this only fixes table-level GRANTs. Must run before the
-- first CREATE TABLE so all subsequent tables inherit it.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  created_at timestamptz not null default now()
);

alter table public.sites enable row level security;

-- Seed the three real sites.
insert into public.sites (name) values
  ('Site 1'), ('Site 2'), ('Site 3');
