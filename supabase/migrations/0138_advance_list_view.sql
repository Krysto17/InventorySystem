-- ─── The advance list, searchable ───────────────────────────────────────────
-- The screen showed the newest 40 advances and nothing else, so an older one
-- could not be found at all. Searching needs the supplier's name beside the
-- advance's own columns, and PostgREST cannot `or` across an embedded table —
-- hence a flat view.
--
-- security_invoker: an advance still only appears to someone whose RLS policy
-- on `advances` lets them see it.

drop view if exists public.advance_list;
create view public.advance_list with (security_invoker = on) as
  select a.id,
         a.site_id,
         a.supplier_id,
         sup.name          as supplier_name,
         sup.supplier_code as supplier_code,
         a.purpose,
         a.amount_naira,
         a.approval_status,
         a.comment,
         a.account_name,
         a.account_number,
         a.bank_name,
         a.created_at
    from public.advances a
    left join public.suppliers sup on sup.id = a.supplier_id;

comment on view public.advance_list is
  'Advances with the supplier name flattened alongside, so the list can be searched in SQL.';

grant select on public.advance_list to authenticated;
