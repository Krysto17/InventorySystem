"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type IntakeState = { error?: string };

export async function submitGateIntake(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate") return { error: "Only gate can intake visits" };
  if (!me.site_id) return { error: "Gate user must be assigned to a site" };

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();
  const newSupplierName = String(formData.get("new_supplier_name") ?? "").trim();
  const newSupplierPhone = String(formData.get("new_supplier_phone") ?? "").trim();
  const newSupplierNotes = String(formData.get("new_supplier_notes") ?? "").trim();
  const vehiclePlate = String(formData.get("vehicle_plate") ?? "").trim() || null;
  const materialTypeId = String(formData.get("declared_material_type_id") ?? "").trim();
  const entryPath = String(formData.get("entry_path") ?? "").trim();

  if (!materialTypeId) return { error: "Material type is required" };
  if (entryPath !== "unprocessed" && entryPath !== "pre_processed") {
    return { error: "Entry path is required" };
  }

  const supabase = await createClient();

  let supplierId = supplierIdRaw;
  if (!supplierId) {
    if (!newSupplierName) return { error: "Supplier name is required (or pick an existing supplier)" };
    const { data: created, error: supErr } = await supabase
      .from("suppliers")
      .insert({
        name: newSupplierName,
        phone: newSupplierPhone || null,
        notes: newSupplierNotes || null,
        created_by: me.id,
      })
      .select("id")
      .single();
    if (supErr || !created) return { error: supErr?.message ?? "Failed to create supplier" };
    supplierId = created.id as string;
  }

  const { data: visit, error: vErr } = await supabase
    .from("visits")
    .insert({
      site_id: me.site_id,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      vehicle_plate: vehiclePlate,
      entry_path: entryPath,
      state: "at_gate_in",
      created_by: me.id,
    })
    .select("id")
    .single();
  if (vErr || !visit) return { error: vErr?.message ?? "Failed to create visit" };

  const nextState = entryPath === "unprocessed" ? "in_processing" : "in_receiving";
  const { error: tErr } = await supabase
    .from("visits")
    .update({ state: nextState })
    .eq("id", visit.id as string);
  if (tErr) return { error: tErr.message };

  redirect(`/visits/${visit.id}`);
}

export async function updateGateIntake(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const patch: Record<string, string | null> = {};
  const v = (k: string) => {
    const raw = formData.get(k);
    return raw == null ? null : String(raw).trim();
  };
  const vp = v("vehicle_plate"); if (vp != null) patch.vehicle_plate = vp || null;
  const dm = v("declared_material_type_id"); if (dm) patch.declared_material_type_id = dm;
  const ep = v("entry_path"); if (ep === "unprocessed" || ep === "pre_processed") patch.entry_path = ep;
  const sup = v("supplier_id"); if (sup) patch.supplier_id = sup;

  const supabase = await createClient();
  const { error } = await supabase.from("visits").update(patch).eq("id", visitId);
  if (error) return { error: error.message };
  return {};
}

export async function releaseVisit(visitId: string): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate" && me.role !== "owner") return { error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("visits")
    .update({ state: "exited" })
    .eq("id", visitId);
  if (error) return { error: error.message };
  return {};
}
