-- ─── The analyst's own completed list, resolved in the database ─────────────
-- listQcCompletedVisits fetched EVERY xrf_record the analyst had ever written,
-- pulled the visit ids out in JavaScript, and asked for those visits with
-- `id=in.(…)`. One analyst reached 914 records across 629 visits, which is a
-- ~24 KB query string — past what the gateway will accept, so the request
-- failed, the query threw, and the QC home page 500'd. It degraded silently as
-- the analyst did more work: fine at fifty visits, broken at six hundred.
--
-- Every other role's done-list filters by state and takes 25 rows. QC's is the
-- only one keyed by an id list, so this is the only page that hit it.
--
-- The view resolves the analyst → visit relationship in Postgres. The page then
-- asks for the newest 25 ids, which is a query string of under a kilobyte.
-- security_invoker keeps the existing visibility rules on visits and xrf_records.

drop view if exists public.qc_analyst_visits;
create view public.qc_analyst_visits with (security_invoker = on) as
  select x.recorded_by            as analyst_id,
         vm.visit_id              as visit_id,
         v.state                  as visit_state,
         max(coalesce(x.updated_at, x.created_at)) as last_analysed_at
    from public.xrf_records x
    join public.visit_materials vm on vm.id = x.visit_material_id
    join public.visits v           on v.id = vm.visit_id
   where x.recorded_by is not null
   group by x.recorded_by, vm.visit_id, v.state;

comment on view public.qc_analyst_visits is
  'One row per (analyst, visit) they have XRF''d, so the done-list never round-trips ids through the URL.';

grant select on public.qc_analyst_visits to authenticated;

-- The join behind the view.
create index if not exists xrf_records_recorded_by_idx
  on public.xrf_records (recorded_by);
