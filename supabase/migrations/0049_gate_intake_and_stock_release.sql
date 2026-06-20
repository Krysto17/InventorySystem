-- ─── Bring the gate role back as the Phase 1/2 pipeline entry ────────────────
-- The role previously shipped as `security` (0047/0048) is repurposed as `gate`
-- (the 'gate' enum value still exists — orphaned in Phase 7 — so no enum change
-- is needed). The gate now:
--   • creates visits at a new `at_gate_in` dwell state (supplier + vehicle plate
--     + entry path), then sends them in to processing / receiving;
--   • issues movement logs + acknowledges manager/owner-issued gate passes.
-- A gate pass can now reference an available stock LOT (traceable back to
-- receiving via stock_lots.ref_visit_material_id); acknowledging the pass writes
-- a stock_movements 'out' row (reason 'gate_release'), removing it from stock.

-- ── 1. Re-add vehicle capture at the gate ────────────────────────────────────
alter table public.visits add column if not exists vehicle_plate text;

-- ── 2. Widen the visit state CHECK to include at_gate_in ─────────────────────
alter table public.visits drop constraint if exists visits_state_check;
alter table public.visits add constraint visits_state_check check (state in (
  'at_gate_in','in_processing','in_receiving','in_qc','pricing','in_accounting',
  'exited','awaiting_stock_intake','stocked'
));

-- ── 3. State-machine validator: add at_gate_in → in_processing / in_receiving ─
create or replace function public._visits_validate_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_legal boolean;
  has_analysis boolean;
  has_submitted_xrf boolean;
  has_lines boolean;
  all_exempt boolean;
begin
  if NEW.state = OLD.state then return NEW; end if;

  is_legal := (OLD.state, NEW.state) in (
    ('at_gate_in','in_processing'),
    ('at_gate_in','in_receiving'),
    ('in_processing','in_receiving'),
    ('in_receiving','in_qc'),
    ('in_receiving','pricing'),
    ('in_qc','pricing'),
    ('pricing','in_accounting'),
    ('pricing','exited'),
    ('pricing','stocked'),
    ('in_accounting','awaiting_stock_intake'),
    ('in_accounting','stocked'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not public.is_owner() then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state using errcode = '22000';
  end if;

  if NEW.state = 'in_qc' then
    select exists (select 1 from public.visit_materials where visit_id = NEW.id) into has_lines;
    if not has_lines then raise exception 'cannot enter QC without material lines'; end if;
  end if;

  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    select exists (
      select 1 from public.visit_materials vm
        join public.xrf_records x on x.visit_material_id = vm.id
      where vm.visit_id = NEW.id and x.submitted
    ) into has_submitted_xrf;
    select exists (select 1 from public.visit_materials where visit_id = NEW.id)
       and not exists (select 1 from public.visit_materials where visit_id = NEW.id and requires_analysis)
      into all_exempt;
    if not has_analysis and not has_submitted_xrf and not all_exempt then
      raise exception 'cannot enter pricing without analysis_records row or a submitted XRF result';
    end if;
  end if;

  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end; $$;

-- ── 4. Audit trigger: re-include vehicle_plate; refresh owner-override edges ──
create or replace function public._visits_write_audit()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'visit_created', NEW.created_by,
      jsonb_build_object(
        'entry_path', NEW.entry_path,
        'supplier_id', NEW.supplier_id,
        'declared_material_type_id', NEW.declared_material_type_id,
        'vehicle_plate', NEW.vehicle_plate,
        'site_id', NEW.site_id
      )
    );
    return NEW;
  end if;

  if NEW.state <> OLD.state then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.id, 'state_changed', auth.uid(),
            jsonb_build_object('from', OLD.state, 'to', NEW.state));

    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('at_gate_in','in_processing'),
      ('at_gate_in','in_receiving'),
      ('in_processing','in_receiving'),
      ('in_receiving','in_qc'),
      ('in_receiving','pricing'),
      ('in_qc','pricing'),
      ('pricing','in_accounting'),
      ('pricing','exited'),
      ('pricing','stocked'),
      ('in_accounting','awaiting_stock_intake'),
      ('in_accounting','stocked'),
      ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;

  return NEW;
end; $$;

-- ── 5. Visits RLS: the gate creates + advances visits (alongside processing) ──
drop policy if exists "visits: processing inserts own site" on public.visits;
create policy "visits: gate/processing insert own site"
  on public.visits for insert to authenticated
  with check (
    (public.current_role() in ('gate','processing') and site_id = public.current_site())
    or public.is_owner()
  );

drop policy if exists "visits: processing updates own site" on public.visits;
create policy "visits: gate/processing update own site"
  on public.visits for update to authenticated
  using (
    (public.current_role() in ('gate','processing') and site_id = public.current_site())
    or public.is_owner()
  )
  with check (
    (public.current_role() in ('gate','processing') and site_id = public.current_site())
    or public.is_owner()
  );

-- ── 6. Repoint the gate-pass / gate-log RLS from 'security' to 'gate' ─────────
drop policy if exists "gate_passes: security ack / manager-owner cancel" on public.gate_passes;
create policy "gate_passes: gate ack / manager-owner cancel"
  on public.gate_passes for update to authenticated
  using (
    public.is_owner()
    or (public.current_role() in ('gate', 'manager') and site_id = public.current_site())
  )
  with check (
    public.is_owner()
    or (public.current_role() in ('gate', 'manager') and site_id = public.current_site())
  );

drop policy if exists "gate_logs: security records own site" on public.gate_logs;
create policy "gate_logs: gate records own site"
  on public.gate_logs for insert to authenticated
  with check (
    public.is_owner()
    or (public.current_role() = 'gate' and site_id = public.current_site())
  );

-- ── 7. Gate pass references an available stock lot (traces back to receiving) ─
alter table public.gate_passes
  add column if not exists stock_lot_id uuid references public.stock_lots(id);

-- ── 8. Allow a 'gate_release' reason on the stock ledger ─────────────────────
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('purchase_intake', 'bulk_sale', 'adjustment', 'gate_release'));

-- ── 9. Acknowledging a pass (issued → acknowledged) removes the lot from stock ─
create or replace function public._gate_passes_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  lot record;
  out_weight numeric(12,3);
begin
  if NEW.status = OLD.status then return NEW; end if;

  if OLD.status = 'issued' and NEW.status = 'acknowledged' then
    if auth.uid() is not null and public.current_role() <> 'gate' then
      raise exception 'only the gate can acknowledge a gate pass';
    end if;
    NEW.acknowledged_by := coalesce(NEW.acknowledged_by, auth.uid());
    NEW.acknowledged_at := coalesce(NEW.acknowledged_at, now());

    -- Material tied to a stock lot leaves stock on acknowledgement.
    if NEW.stock_lot_id is not null then
      select * into lot from public.stock_lots where id = NEW.stock_lot_id;
      -- NB: `record IS NOT NULL` is only true when every column is non-null,
      -- so test the primary key, not the whole record.
      if lot.id is not null then
        out_weight := coalesce(NEW.weight_kg, lot.weight_kg);
        insert into public.stock_movements (
          site_id, material_type_id, grade, weight, direction, recorded_by, reason
        ) values (
          lot.site_id, lot.material_type_id, null, out_weight, 'out',
          coalesce(auth.uid(), NEW.issued_by), 'gate_release'
        );
      end if;
    end if;

  elsif OLD.status = 'issued' and NEW.status = 'cancelled' then
    if auth.uid() is not null and not (public.is_owner() or public.current_role() = 'manager') then
      raise exception 'only a manager or owner can cancel a gate pass';
    end if;
  else
    raise exception 'illegal gate pass transition: % → %', OLD.status, NEW.status using errcode = '22000';
  end if;

  return NEW;
end; $$;
