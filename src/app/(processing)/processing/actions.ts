"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type ProcessingState = { error?: string };

// Processing records a material line (e.g. iron weight + comment) while the
// visit is in processing. A supplier/visit can have several lines.
export async function addProcessingMaterialLine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "processing" && me.role !== "owner")) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const weight = Number(formData.get("weight_kg"));
  if (!visitId || !materialTypeId || !(weight >= 0)) return;
  const comment = String(formData.get("receiving_comment") ?? "").trim() || null;

  const supabase = await createClient();
  await supabase.from("visit_materials").insert({
    visit_id: visitId,
    material_type_id: materialTypeId,
    weight_kg: weight,
    receiving_comment: comment,
    recorded_by: me.id,
  });
  revalidatePath(`/visits/${visitId}`);
}

type UsageLine = { machine_id: string; measurement: number };

// ─── Visit creation (replaces the old gate intake; processing owns it now) ────
export type IntakeState = { error?: string };

export async function createVisit(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") {
    return { error: "Only processing can create visits" };
  }
  if (!me.site_id && me.role !== "owner") {
    return { error: "Processing user must be assigned to a site" };
  }

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();
  const newSupplierName = String(formData.get("new_supplier_name") ?? "").trim();
  const newSupplierPhone = String(formData.get("new_supplier_phone") ?? "").trim();
  const newSupplierNotes = String(formData.get("new_supplier_notes") ?? "").trim();
  const materialTypeId = String(formData.get("declared_material_type_id") ?? "").trim();
  const entryPath = String(formData.get("entry_path") ?? "").trim();

  if (!materialTypeId) return { error: "Material type is required" };
  if (entryPath !== "unprocessed" && entryPath !== "processed") {
    return { error: "Entry path is required" };
  }

  const supabase = await createClient();

  let supplierId = supplierIdRaw;
  if (!supplierId) {
    if (!newSupplierName) {
      return { error: "Supplier name is required (or pick an existing supplier)" };
    }
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

  // Visits now start directly at the appropriate pipeline state — no gate stage.
  const initialState = entryPath === "unprocessed" ? "in_processing" : "in_receiving";

  const { data: visit, error: vErr } = await supabase
    .from("visits")
    .insert({
      // Non-owner creators always have a site (enforced at provisioning).
      site_id: me.site_id as string,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      entry_path: entryPath,
      state: initialState,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (vErr || !visit) return { error: vErr?.message ?? "Failed to create visit" };

  redirect(`/visits/${visit.id}`);
}

export async function updateVisitOrigin(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const patch: Record<string, string | null> = {};
  const v = (k: string) => {
    const raw = formData.get(k);
    return raw == null ? null : String(raw).trim();
  };
  const dm = v("declared_material_type_id"); if (dm) patch.declared_material_type_id = dm;
  const sup = v("supplier_id"); if (sup) patch.supplier_id = sup;

  const supabase = await createClient();
  const { error } = await supabase.from("visits").update(patch as never).eq("id", visitId);
  if (error) return { error: error.message };
  revalidatePath(`/visits/${visitId}`);
  return {};
}

export async function submitProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);
  if (cleaned.length === 0) return { error: "At least one machine usage row is required" };

  const supabase = await createClient();

  const { data: machineRows, error: mErr } = await supabase
    .from("machines")
    .select("id, rate")
    .in("id", cleaned.map((l) => l.machine_id));
  if (mErr) return { error: mErr.message };
  const rates = new Map<string, number>(
    (machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]),
  );

  const now = new Date().toISOString();
  const { data: rec, error: prErr } = await supabase
    .from("processing_records")
    .insert({
      visit_id: visitId,
      recorded_by: me.id,
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();
  if (prErr || !rec) return { error: prErr?.message ?? "Failed to create processing record" };

  const usageRows = cleaned.map((l) => ({
    processing_record_id: rec.id as string,
    machine_id: l.machine_id,
    measurement: l.measurement,
    rate_snapshot: rates.get(l.machine_id) ?? 0,
  }));
  const { error: uErr } = await supabase.from("processing_machine_usage").insert(usageRows);
  if (uErr) return { error: uErr.message };

  // The processing fee is automatically billed to the supplier as a light bill
  // (a utility charge on the visit), which the manager later deducts from — or
  // collects against — the supplier's batch settlement.
  const fee = usageRows.reduce((s, u) => s + u.measurement * u.rate_snapshot, 0);
  if (fee > 0) {
    await supabase.from("utility_charges").insert({
      visit_id: visitId,
      kind: "light_bill",
      description: "Processing fee",
      amount: fee,
      recorded_by: me.id,
    });
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/processing");
  return {};
}

export async function updateProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { error: "Missing record id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);

  const supabase = await createClient();

  const { error: delErr } = await supabase
    .from("processing_machine_usage")
    .delete()
    .eq("processing_record_id", recordId);
  if (delErr) return { error: delErr.message };

  if (cleaned.length > 0) {
    const { data: machineRows } = await supabase
      .from("machines")
      .select("id, rate")
      .in("id", cleaned.map((l) => l.machine_id));
    const rates = new Map<string, number>(
      (machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]),
    );
    const rows = cleaned.map((l) => ({
      processing_record_id: recordId,
      machine_id: l.machine_id,
      measurement: l.measurement,
      rate_snapshot: rates.get(l.machine_id) ?? 0,
    }));
    await supabase.from("processing_machine_usage").insert(rows);
  }

  await supabase
    .from("processing_records")
    .update({ recorded_by: me.id })
    .eq("id", recordId);

  return {};
}
