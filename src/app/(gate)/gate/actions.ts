"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

async function mySiteId(): Promise<string | null> {
  const me = await getProfile();
  if (!me) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  return (data?.site_id as string | null) ?? null;
}

// The gate registers material moving in/out at the gate.
export async function recordGateLog(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "gate" && me.role !== "owner")) return;
  const siteId = await mySiteId();
  if (!siteId) return;

  const direction = String(formData.get("direction") ?? "");
  if (!["in", "out"].includes(direction)) return;
  const bagsRaw = String(formData.get("bags") ?? "").trim();
  const gatePassId = String(formData.get("gate_pass_id") ?? "") || null;

  const supabase = await createClient();
  await supabase.from("gate_logs").insert({
    site_id: siteId,
    direction,
    driver_name: String(formData.get("driver_name") ?? "").trim() || null,
    driver_phone: String(formData.get("driver_phone") ?? "").trim() || null,
    bags: bagsRaw === "" ? null : Number(bagsRaw),
    material_owner: String(formData.get("material_owner") ?? "").trim() || null,
    reason: String(formData.get("reason") ?? "").trim() || null,
    gate_pass_id: gatePassId,
    recorded_by: me.id,
  });
  revalidatePath("/gate");
}

// The gate acknowledges a manager/owner-issued gate pass before release. If the
// pass is tied to a stock lot, the DB trigger writes the stock 'out' movement.
export async function acknowledgeGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "gate") return;
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("gate_passes").update({ status: "acknowledged" }).eq("id", id);
  revalidatePath("/gate");
}

// ─── Phase 1/2 gate intake: the gate is the pipeline entry ───────────────────
export type IntakeState = { error?: string };

export async function createGateVisit(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate" && me.role !== "owner") return { error: "Only the gate can log a visit in" };
  if (!me.site_id && me.role !== "owner") return { error: "Gate user must be assigned to a site" };

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();
  const newSupplierName = String(formData.get("new_supplier_name") ?? "").trim();
  const newSupplierPhone = String(formData.get("new_supplier_phone") ?? "").trim();
  const newSupplierNotes = String(formData.get("new_supplier_notes") ?? "").trim();
  const materialTypeId = String(formData.get("declared_material_type_id") ?? "").trim();
  const entryPath = String(formData.get("entry_path") ?? "").trim();
  const vehiclePlate = String(formData.get("vehicle_plate") ?? "").trim();

  if (!materialTypeId) return { error: "Material type is required" };
  if (entryPath !== "unprocessed" && entryPath !== "processed") {
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

  // The visit dwells at the gate until the gate sends it in.
  const { data: visit, error: vErr } = await supabase
    .from("visits")
    .insert({
      site_id: me.site_id,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      entry_path: entryPath,
      vehicle_plate: vehiclePlate || null,
      state: "at_gate_in",
      created_by: me.id,
    })
    .select("id")
    .single();
  if (vErr || !visit) return { error: vErr?.message ?? "Failed to create visit" };

  redirect(`/visits/${visit.id}`);
}

// Gate sends a dwelling visit into the pipeline: unprocessed → processing,
// processed → straight to receiving.
export async function sendVisitIn(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "gate" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits")
    .select("entry_path, state")
    .eq("id", visitId)
    .single();
  if (!visit || visit.state !== "at_gate_in") return;

  const target = visit.entry_path === "unprocessed" ? "in_processing" : "in_receiving";
  await supabase.from("visits").update({ state: target }).eq("id", visitId);
  revalidatePath("/gate");
  revalidatePath(`/visits/${visitId}`);
}
