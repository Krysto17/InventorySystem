-- ─── Fixes for 0110 ─────────────────────────────────────────────────────────
-- 1. 0110 added a 4th arg (p_kind) to record_debt_repayment but left the old
--    3-arg signature in place, so a 3-arg call is ambiguous (PGRST203).
-- 2. The over-deduction message used printf-style "%.2f", which plpgsql does not
--    support — it rendered as "deduction 30001.00.2f …". Use plain %.

drop function if exists public.record_debt_repayment(uuid, numeric, text);

create or replace function public._advance_deductions_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare outstanding numeric;
begin
  if NEW.kind = 'processing' then
    outstanding := public.supplier_processing_debt(NEW.supplier_id);
  else
    outstanding := public.supplier_outstanding_debt(NEW.supplier_id);
  end if;
  if NEW.amount > outstanding then
    raise exception 'deduction % exceeds outstanding debt % (%)', NEW.amount, outstanding, NEW.kind
      using errcode = '23514';
  end if;
  return NEW;
end; $$;
