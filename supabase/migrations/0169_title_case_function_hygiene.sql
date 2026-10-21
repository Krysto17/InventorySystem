-- 0169 — Close the two advisor warnings 0168 introduced
--
-- 0168 added two functions and the Supabase advisor flagged both. Neither is a
-- hole today, but the project has been here before: 0164 published a view to
-- `anon` by accident because Supabase's default privileges hand every new
-- object in `public` to anon, authenticated and service_role, and 0165 had to
-- clean it up. The same default applied to these two functions, so they get the
-- same treatment rather than being left as standing warnings.
--
-- 1. `title_case_name` had a role-mutable search_path. It touches no tables, so
--    there is nothing to hijack by shadowing a name — but a function without a
--    fixed search_path is a lint on every audit, and pinning it costs nothing.
--
-- 2. `_suppliers_title_case_name` is SECURITY DEFINER (so that a caller without
--    EXECUTE on title_case_name can still save a supplier) and was executable
--    by `anon` and `authenticated`. A definer function reachable by anon is
--    precisely what the advisor objects to, and rightly. Nothing needs to call
--    it directly: Postgres checks EXECUTE on a trigger function when the
--    TRIGGER IS CREATED, not when it fires, so revoking execute from everyone
--    leaves the trigger working exactly as before. Verified on a local database
--    before this was written: inserts as service_role and as an authenticated
--    role still title-case the name with no grant in place.

create or replace function public.title_case_name(p_name text)
  returns text
  language sql
  immutable
  set search_path to 'public'
as $function$
  select nullif(
    (select string_agg(
       case
         when w ~ '[[:lower:]]' and w ~ '[[:upper:]]' then w
         when w ~ '[.'']' then w
         else initcap(w)
       end, ' ' order by ord)
       from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+')
            with ordinality as t(w, ord)),
    '');
$function$;

comment on function public.title_case_name(text) is
  'A supplier name in Title Case: each single-case word is capitalised, a word '
  'with inner capitals (McDonald, DeSouza) or a full stop or apostrophe '
  '(A.A., Mus''ab) is kept as typed, whitespace runs collapse. See 0168.';

revoke execute on function public.title_case_name(text) from public, anon;
grant  execute on function public.title_case_name(text) to authenticated, service_role;

-- Nothing calls this except the trigger, and a trigger needs no EXECUTE grant
-- to fire.
revoke execute on function public._suppliers_title_case_name() from public, anon, authenticated, service_role;
