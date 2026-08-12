-- ─── Machine utilisation totalled in SQL ────────────────────────────────────
-- The owner dashboard pulled every machine-usage row in the period with the
-- processing record and its visit nested inside, then filtered by site and
-- summed per machine in JavaScript. One row per machine per period is all the
-- panel draws.
--
-- The fee credited is net of the per-batch discount (that discount IS the light
-- bill), which is why this cannot just sum line_cost.

create or replace function public.machine_utilization(
  p_from timestamptz,
  p_to   timestamptz,
  p_site uuid default null
)
returns table (machine_name text, charge_basis text, total_measurement numeric, total_fee numeric)
language sql stable security invoker set search_path = public as $$
  select m.name,
         m.charge_basis,
         sum(u.measurement)::numeric,
         sum(u.line_cost * (1 - coalesce(pr.discount_percent, 0) / 100.0))::numeric
    from public.processing_machine_usage u
    join public.machines m           on m.id = u.machine_id
    join public.processing_records pr on pr.id = u.processing_record_id
    join public.visits v              on v.id = pr.visit_id
   where pr.completed_at >= p_from
     and pr.completed_at <= p_to
     and (p_site is null or v.site_id = p_site)
   group by m.name, m.charge_basis
   order by 4 desc;
$$;

grant execute on function public.machine_utilization(timestamptz, timestamptz, uuid) to authenticated;
