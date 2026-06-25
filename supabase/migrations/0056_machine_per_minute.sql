-- ─── Machines: add a per-minute charge basis ────────────────────────────────
-- Some machines are billed by the minute. Add 'minute' alongside the existing
-- weight / bag / hour bases. Processing cost is still measurement × rate.

alter table public.machines drop constraint if exists machines_charge_basis_check;
alter table public.machines add constraint machines_charge_basis_check
  check (charge_basis in ('weight', 'bag', 'hour', 'minute'));
