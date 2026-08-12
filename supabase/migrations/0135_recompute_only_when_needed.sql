-- ─── Only recompute the batch total when the batch total can have moved ─────
-- Editing a line wrote to the pricing row every time — "update pricing set
-- unit_price = unit_price" — purely to fire the BEFORE trigger that recomputes
-- purchase_amount. So correcting a typo in a receiving comment took a write on
-- another table and a trigger chain with it.
--
-- The total is the sum of the settled lines' amounts. It can only move when a
-- line's own amount moves, or when a line joins or leaves the settled set. On
-- an insert or delete it always can.

create or replace function public._visit_materials_after()
  returns trigger language plpgsql security definer set search_path = public as $$
declare v_diff jsonb; v_total_may_have_moved boolean;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id,
                               'material_type_id', NEW.material_type_id,
                               'weight_kg', NEW.weight_kg));
    v_total_may_have_moved := true;
  else
    v_diff := public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW));
    if v_diff <> '{}'::jsonb then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.visit_id, 'record_edited', auth.uid(),
              jsonb_build_object('table', 'visit_materials', 'record_id', NEW.id, 'diff', v_diff));
    end if;
    v_total_may_have_moved :=
      NEW.purchase_amount is distinct from OLD.purchase_amount
      or NEW.settlement_status is distinct from OLD.settlement_status;
  end if;

  if v_total_may_have_moved then
    -- A no-op write whose only job is to fire _pricing_set_purchase_amount.
    update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  end if;
  return NEW;
end; $$;

-- Removing a line changes the total too, and the AFTER UPDATE/INSERT trigger
-- never sees a delete.
create or replace function public._visit_materials_after_delete()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pricing set unit_price = unit_price where visit_id = OLD.visit_id;
  return OLD;
end; $$;

drop trigger if exists t_visit_materials_after_delete on public.visit_materials;
create trigger t_visit_materials_after_delete
  after delete on public.visit_materials
  for each row execute function public._visit_materials_after_delete();
