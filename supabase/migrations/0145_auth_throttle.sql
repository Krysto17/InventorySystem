-- ─── H-03: authentication abuse control ─────────────────────────────────────
-- Sign-in had no application-side cost for a wrong guess, and the account
-- namespace is guessable: usernames are first names mapping deterministically
-- to <username>@magneticjoezion.local.
--
-- Deliberately NOT a lockout. Locking an account after N failures hands any
-- attacker a denial-of-service against a named employee for free — they simply
-- fail the login on purpose and the person cannot work. What raises the cost of
-- guessing without creating that weapon is a progressive delay that decays on
-- its own and is capped.
--
-- Deliberately NOT a third-party rate limiter. This deploys to Vercel, where
-- instances are ephemeral and in-process counters are worthless, but Postgres
-- is already there, already durable and already shared by every instance. A new
-- service would add a dependency, a secret and an outage mode for no gain at
-- this scale.
--
-- Both the counter and the decision live behind SECURITY DEFINER functions.
-- The table itself is readable by nobody: it records failure counts against
-- usernames and IPs, which is exactly the sort of thing that should not be
-- queryable by a signed-in user.

create table if not exists public.auth_throttle (
  bucket        text primary key,          -- 'ip:1.2.3.4' or 'user:debbie'
  failures      integer not null default 0,
  first_failure timestamptz not null default now(),
  last_failure  timestamptz not null default now(),
  retry_after   timestamptz
);

comment on table public.auth_throttle is
  'Failed sign-in counters per IP and per username. Written only by SECURITY DEFINER functions; no role may read it.';

create index if not exists auth_throttle_retry_idx on public.auth_throttle (retry_after);

alter table public.auth_throttle enable row level security;
-- No policies: RLS with none denies every role. Only the definer functions
-- below touch this table, and they run as their owner.

-- How long a bucket waits after n failures. Nothing happens for the first few
-- attempts — people mistype — then the delay climbs and stops climbing, so the
-- worst an attacker can inflict on someone is a two-minute wait that clears
-- itself, not a locked account somebody has to ring the owner about.
create or replace function public._auth_backoff(p_failures integer)
  returns interval language sql immutable as $$
  select case
    when p_failures < 4  then interval '0'
    when p_failures < 6  then interval '5 seconds'
    when p_failures < 8  then interval '15 seconds'
    when p_failures < 12 then interval '45 seconds'
    else interval '2 minutes'
  end;
$$;

-- Called before the password is checked. Returns the seconds still to wait, or
-- 0 to proceed. Never says whether the username exists.
create or replace function public.auth_throttle_check(p_buckets text[])
  returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    max(ceil(extract(epoch from (t.retry_after - now()))))::integer, 0)
  from public.auth_throttle t
  where t.bucket = any(p_buckets)
    and t.retry_after is not null
    and t.retry_after > now();
$$;

-- Called after a failed attempt. A bucket that has been quiet for 15 minutes
-- starts again from zero, so a normal user who mistypes today is not carrying
-- yesterday's count.
create or replace function public.auth_throttle_fail(p_buckets text[])
  returns void language plpgsql security definer set search_path = public as $$
declare b text; n integer;
begin
  foreach b in array p_buckets loop
    insert into public.auth_throttle (bucket, failures)
    values (b, 1)
    on conflict (bucket) do update
      set failures = case
            when public.auth_throttle.last_failure < now() - interval '15 minutes' then 1
            else public.auth_throttle.failures + 1
          end,
          first_failure = case
            when public.auth_throttle.last_failure < now() - interval '15 minutes' then now()
            else public.auth_throttle.first_failure
          end,
          last_failure = now()
    returning failures into n;

    update public.auth_throttle
       set retry_after = now() + public._auth_backoff(n)
     where bucket = b;
  end loop;
end; $$;

-- A successful sign-in clears that user's own counters, so one person getting
-- in does not leave the next attempt throttled.
create or replace function public.auth_throttle_clear(p_buckets text[])
  returns void language sql security definer set search_path = public as $$
  delete from public.auth_throttle where bucket = any(p_buckets);
$$;

-- Sign-in happens before there is a session, so anon must be able to call these.
-- They take a bucket key and return a number or nothing; they expose no data.
grant execute on function public.auth_throttle_check(text[]) to anon, authenticated;
grant execute on function public.auth_throttle_fail(text[])  to anon, authenticated;
grant execute on function public.auth_throttle_clear(text[]) to anon, authenticated;
revoke execute on function public._auth_backoff(integer) from public, anon, authenticated;

-- Housekeeping: drop rows that have been quiet for a day. Owner-run; nothing
-- depends on it, the table simply stays small.
create or replace function public.prune_auth_throttle()
  returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_owner() then raise exception 'only the owner can prune the throttle table'; end if;
  with gone as (
    delete from public.auth_throttle where last_failure < now() - interval '1 day' returning bucket
  ) select count(*) into n from gone;
  return n;
end; $$;

-- Functions are executable by PUBLIC the moment they are created, so granting
-- to `authenticated` alone would have left this callable by anon as well. The
-- body rejects a non-owner, but a privilege model that is explicit beats one
-- that relies on the body: anon has no business reaching a maintenance routine
-- at all.
--
-- `authenticated` — not service_role — is the grantee because is_owner() reads
-- the caller's session; the service key carries no user, so it could never pass
-- the check. The owner test therefore stays as the authorization, and cannot be
-- expressed as a GRANT: "owner" is a row in profiles, not a database role.
revoke execute on function public.prune_auth_throttle() from public, anon;
grant execute on function public.prune_auth_throttle() to authenticated;
