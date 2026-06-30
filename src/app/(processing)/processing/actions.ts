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
  const isOwner = me.role === "owner";
  if (!isOwner && me.role !== "processing" && me.role !== "receiving") {
    return { error: "Only processing or receiving can create visits" };
  }
  if (!me.site_id && !isOwner) {
    return { error: "Intake user must be assigned to a site" };
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
  // Intake is split by entry path (#3): processing handles unprocessed (plant
  // first), receiving handles pre-processed (straight to receiving).
  if (!isOwner) {
    if (me.role === "processing" && entryPath !== "unprocessed") {
      return { error: "Processing intake is for unprocessed material only" };
    }
    if (me.role === "receiving" && entryPath !== "processed") {
      return { error: "Receiving intake is for processed material only" };
    }
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

  // Machine-usage rows (the processing fee).
  const lines: UsageLine[] = [];
  // Material lines (e.g. iron weights) entered in the same form (#7).
  const mats: { material_type_id: string; weight_kg: number; comment: string }[] = [];
  for (const [key, val] of formData.entries()) {
    const um = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (um) {
      const idx = Number(um[1]);
      lines[idx] ??= { machine_id: "", measurement: 0 };
      if (um[2] === "machine_id") lines[idx].machine_id = String(val);
      else lines[idx].measurement = Number(val);
      continue;
    }
    const mm = key.match(/^material\[(\d+)\]\[(material_type_id|weight_kg|comment)\]$/);
    if (mm) {
      const idx = Number(mm[1]);
      mats[idx] ??= { material_type_id: "", weight_kg: 0, comment: "" };
      if (mm[2] === "material_type_id") mats[idx].material_type_id = String(val);
      else if (mm[2] === "weight_kg") mats[idx].weight_kg = Number(val);
      else mats[idx].comment = String(val);
    }
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);
  const cleanMats = mats.filter((m) => m && m.material_type_id && m.weight_kg > 0);
  // Machine usage is optional — a New-Site batch may just weigh material (e.g.
  // iron) with no machine processing. Require at least one of the two so the
  // visit still advances to receiving, where receiving adds further lines.
  if (cleaned.length === 0 && cleanMats.length === 0) {
    return { error: "Add at least one machine-usage row or material line" };
  }

  // Per-batch processing discount (0–100%), recorded for managers; applied to fee.
  const discountPercent = Math.min(100, Math.max(0, Number(formData.get("discount_percent")) || 0));

  const supabase = await createClient();

  const rates = new Map<string, number>();
  if (cleaned.length > 0) {
    const { data: machineRows, error: mErr } = await supabase
      .from("machines")
      .select("id, rate")
      .in("id", cleaned.map((l) => l.machine_id));
    if (mErr) return { error: mErr.message };
    for (const r of machineRows ?? []) rates.set(r.id as string, Number(r.rate));
  }

  // Material lines first — they may only be inserted while the visit is still
  // in_processing, and the processing_record insert below advances it to
  // in_receiving via trigger.
  if (cleanMats.length > 0) {
    const { error: matErr } = await supabase.from("visit_materials").insert(
      cleanMats.map((m) => ({
        visit_id: visitId,
        material_type_id: m.material_type_id,
        weight_kg: m.weight_kg,
        receiving_comment: m.comment.trim() || null,
        recorded_by: me.id,
      })),
    );
    if (matErr) return { error: matErr.message };
  }

  const now = new Date().toISOString();
  const { data: rec, error: prErr } = await supabase
    .from("processing_records")
    .insert({
      visit_id: visitId,
      recorded_by: me.id,
      started_at: now,
      completed_at: now,
      discount_percent: discountPercent,
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
  if (usageRows.length > 0) {
    const { error: uErr } = await supabase.from("processing_machine_usage").insert(usageRows);
    if (uErr) return { error: uErr.message };
  }

  // The processing fee is billed to the supplier as a light bill (a utility
  // charge on the visit), net of the per-batch discount.
  const gross = usageRows.reduce((s, u) => s + u.measurement * u.rate_snapshot, 0);
  const fee = gross * (1 - discountPercent / 100);
  if (fee > 0) {
    await supabase.from("utility_charges").insert({
      visit_id: visitId,
      kind: "light_bill",
      description: discountPercent > 0 ? `Processing fee (${discountPercent}% discount)` : "Processing fee",
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
