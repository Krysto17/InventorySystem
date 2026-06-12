"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Receiving adds a material line to an in_receiving batch.
export async function addMaterialLine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "receiving" && me.role !== "owner") return;

  const visitId = String(formData.get("visit_id") ?? "");
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const weight = Number(formData.get("weight_kg"));
  if (!visitId || !materialTypeId || !(weight >= 0)) return;

  const magnetic = String(formData.get("magnetic_analysis") ?? "").trim() || null;
  const comment = String(formData.get("receiving_comment") ?? "").trim() || null;
  const requiresAnalysis = formData.get("requires_analysis") != null;

  const supabase = await createClient();
  await supabase.from("visit_materials").insert({
    visit_id: visitId,
    material_type_id: materialTypeId,
    weight_kg: weight,
    magnetic_analysis: magnetic,
    receiving_comment: comment,
    requires_analysis: requiresAnalysis,
    recorded_by: me.id,
  });
  revalidatePath(`/visits/${visitId}`);
}

// Receiving signals the batch is fully weighed → advance to QC.
export async function advanceToQc(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("advance_visit_to_qc", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  revalidatePath("/qc");
}

// QC records / updates the XRF result for a line. `submit` marks it final;
// once every line is submitted the visit auto-advances to pricing.
export async function recordXrf(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "qc" && me.role !== "owner") return;

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const result = String(formData.get("result") ?? "").trim() || null;
  const submitted = String(formData.get("submitted") ?? "") === "true";
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  const weightKg = weightRaw === "" ? null : Number(weightRaw);
  if (!lineId) return;

  const supabase = await createClient();
  // Upsert one XRF record per line (visit_material_id is unique).
  const { data: existing } = await supabase
    .from("xrf_records")
    .select("id")
    .eq("visit_material_id", lineId)
    .maybeSingle();

  if (existing) {
    await supabase.from("xrf_records")
      .update({ result, submitted, weight_kg: weightKg })
      .eq("id", existing.id);
  } else {
    await supabase.from("xrf_records").insert({
      visit_material_id: lineId, result, submitted, weight_kg: weightKg, recorded_by: me.id,
    });
  }
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/qc");
}

// Manager / owner assigns the optional per-line price.
export async function setLinePrice(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "manager" && me.role !== "owner") return;

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const priceRaw = String(formData.get("unit_price") ?? "").trim();
  if (!lineId) return;
  const unitPrice = priceRaw === "" ? null : Number(priceRaw);

  const supabase = await createClient();
  await supabase
    .from("visit_materials")
    .update({ unit_price: unitPrice, priced_by: me.id })
    .eq("id", lineId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}
