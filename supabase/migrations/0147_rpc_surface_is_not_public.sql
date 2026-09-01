-- ─── L-1: the reporting RPCs were reachable without signing in ──────────────
-- Eight SECURITY DEFINER functions could be executed by `anon`. Because they
-- are definers they answer with the definer's privileges, so RLS never applied
-- and no session was needed. Verified against production: an unauthenticated
-- caller holding the anon key — the key that ships to every browser — invoked
--
--   find_similar_suppliers('<a name>', null, null)
--
-- and received supplier rows carrying account_name, account_number and
-- bank_name. That function is the severe one because it takes a NAME rather
-- than an id, so the supplier directory is enumerable with no prior knowledge;
-- the ids it returns then feed supplier_outstanding_debt and
-- supplier_processing_debt, which answered with figures.
--
-- The cause is the default: a newly created function grants EXECUTE to PUBLIC,
-- and anon inherits it. Every one of the eight still carried that default
-- (`=X/postgres` in proacl), so revoking `anon` alone would have changed
-- nothing — the grant would still arrive through PUBLIC. PUBLIC is therefore
-- what is removed here, and anon with it.
--
-- `authenticated` and `service_role` hold their own explicit grants, so they
-- are untouched by removing PUBLIC. That is deliberate: this migration closes
-- the anonymous hole without altering the signed-in surface.

revoke execute on function public.find_similar_suppliers(text, text, uuid)  from public, anon;
revoke execute on function public.supplier_outstanding_debt(uuid)           from public, anon;
revoke execute on function public.supplier_processing_debt(uuid)            from public, anon;
revoke execute on function public.supplier_carried_light_bills(uuid)        from public, anon;
revoke execute on function public.settlement_totals(uuid)                   from public, anon;
revoke execute on function public.settlement_paid_total(uuid)               from public, anon;
revoke execute on function public.visit_is_open(uuid)                       from public, anon;
revoke execute on function public.pricing_has_acted(uuid)                   from public, anon;

-- Two of the eight are reachable from nowhere at all: no call in the
-- application, no other function, no view, and no RLS policy references them.
-- A function nobody calls needs no grant, and leaving one executable is how a
-- future caller acquires a privilege by accident rather than by decision.
revoke execute on function public.supplier_carried_light_bills(uuid) from authenticated;
revoke execute on function public.pricing_has_acted(uuid)            from authenticated;

-- The end state is then stated outright rather than left to whatever the ACL
-- happened to hold. Removing PUBLIC also removes anything a role held ONLY
-- through PUBLIC, and which roles carry their own explicit grant differs
-- between a database grown over time and one replayed from these files: this
-- production database has explicit grants for anon, authenticated and
-- service_role, while a fresh replay does not. Verified locally — without the
-- grants below, replaying this file leaves visit_is_open unexecutable by
-- `authenticated`, and the eight RLS policies that call it fail with
-- "permission denied for function visit_is_open", which stops a manager
-- pricing a line. A migration whose result depends on the ACL it inherits is
-- not reproducible, so the grants are spelled out.
grant execute on function public.find_similar_suppliers(text, text, uuid)  to authenticated;
grant execute on function public.supplier_outstanding_debt(uuid)           to authenticated;
grant execute on function public.supplier_processing_debt(uuid)            to authenticated;
grant execute on function public.settlement_totals(uuid)                   to authenticated;
grant execute on function public.settlement_paid_total(uuid)               to authenticated;
grant execute on function public.visit_is_open(uuid)                       to authenticated;

grant execute on function public.find_similar_suppliers(text, text, uuid)  to service_role;
grant execute on function public.supplier_outstanding_debt(uuid)           to service_role;
grant execute on function public.supplier_processing_debt(uuid)            to service_role;
grant execute on function public.supplier_carried_light_bills(uuid)        to service_role;
grant execute on function public.settlement_totals(uuid)                   to service_role;
grant execute on function public.settlement_paid_total(uuid)               to service_role;
grant execute on function public.visit_is_open(uuid)                       to service_role;
grant execute on function public.pricing_has_acted(uuid)                   to service_role;

-- visit_is_open KEEPS authenticated deliberately. It is not called by the
-- application, but eight RLS policies evaluate it — on pricing, visit_materials,
-- utility_charges, processing_records, processing_machine_usage and
-- analysis_records. Policy expressions run with the caller's privileges, so
-- revoking it from authenticated would not tighten anything; it would make
-- every write those policies guard fail for every signed-in user.
--
-- The other five keep authenticated because the application calls them while
-- signed in, and because they disclose nothing a signed-in user cannot already
-- read: the RLS SELECT policy on suppliers is `using (true)` for authenticated,
-- so supplier account details are already readable from the table itself. That
-- is a wider question than this migration — recorded as a follow-up, not
-- widened into here.

comment on function public.find_similar_suppliers(text, text, uuid) is
  'Duplicate-supplier search for signed-in users. NOT executable by anon: it returns account details and needs no id, so an anonymous caller could enumerate the supplier directory (L-1).';
