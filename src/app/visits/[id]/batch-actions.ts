"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Delete an entire batch supply (#4/#5). The general manager may remove any
// site's batch while it isn't owner-approved; the owner may remove any batch
// until it's paid. The delete_batch RPC re-checks the role + settlement gate.
export async function deleteBatch(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "owner" && !me.is_general_manager) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_batch", { p_visit_id: visitId });
  if (error) return; // gate failed (e.g. already approved/paid) — nothing removed
  revalidatePath("/manager");
  revalidatePath("/owner");
  redirect(me.role === "owner" ? "/owner" : "/manager");
}

// Receiving adds a material line to an in_receiving batch. The general (New-Site)
// manager runs the receiving module too.
export async function addMaterialLine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "receiving" && me.role !== "owner" && !me.is_general_manager) return;

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

// Receiving edits a line's weight / magnetic / comment before sending to QC.
// Receiving corrects a draft line (in receiving); the manager may also correct
// any batch line (e.g. a kg fix) while the visit is still open — RLS enforces
// the manager's own site + open state.
export async function updateMaterialLine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "receiving" && me.role !== "manager" && me.role !== "owner") return;

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const weight = Number(formData.get("weight_kg"));
  if (!lineId || !(weight >= 0)) return;
  const materialTypeId = String(formData.get("material_type_id") ?? "").trim();
  const magnetic = String(formData.get("magnetic_analysis") ?? "").trim() || null;
  const comment = String(formData.get("receiving_comment") ?? "").trim() || null;

  const patch: Record<string, unknown> = {
    weight_kg: weight, magnetic_analysis: magnetic, receiving_comment: comment,
  };
  if (materialTypeId) patch.material_type_id = materialTypeId;

  const supabase = await createClient();
  await supabase.from("visit_materials").update(patch as never).eq("id", lineId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// Receiving deletes a draft material line while the visit is in receiving; the
// general manager may too.
export async function deleteMaterialLine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "receiving" && me.role !== "owner" && !me.is_general_manager) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return;

  const supabase = await createClient();
  await supabase.from("visit_materials").delete().eq("id", lineId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// Receiving's material lines are saved as drafts while the visit is in
// receiving (editable any time); this submits the batch for analysis — straight
// to QC, or to pricing when no line needs analysis (no manager gate, #3).
export async function submitToManager(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("submit_visit_to_manager", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  revalidatePath("/qc");
}

// Manager bypasses XRF analysis from in_qc → pricing (price without XRF, #3).
export async function skipToPricing(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "manager" && me.role !== "owner") return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("manager_skip_to_pricing", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  revalidatePath("/qc");
}

// A line that fails spec/pricing — manager (own site) or owner. Three outcomes:
// unsettle (keep + gate pass + exclude from total), re-settle (reverse), remove.
async function lineAction(formData: FormData, rpc: "unsettle_line" | "resettle_line" | "remove_line") {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return;
  const supabase = await createClient();
  if (rpc === "unsettle_line") {
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await supabase.rpc("unsettle_line", { p_line_id: lineId, p_reason: reason });
  } else {
    await supabase.rpc(rpc, { p_line_id: lineId });
  }
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
}

// Manager/owner submits the priced batch to the owner for approval: records an
// "agreed" pricing agreement (amount comes from the priced lines) which moves
// the visit to awaiting_price_approval (Pricing node → green).
export async function submitPricedBatch(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  const terms = String(formData.get("payment_terms") ?? "").trim();
  if (!visitId || !terms) return;

  const supabase = await createClient();
  // Need at least one priced line (the batch total is the sum of line prices).
  const { count } = await supabase
    .from("visit_materials")
    .select("id", { count: "exact", head: true })
    .eq("visit_id", visitId)
    .not("unit_price", "is", null);
  if (!count) return;

  const { data: existing } = await supabase.from("pricing").select("id").eq("visit_id", visitId).maybeSingle();
  if (existing) {
    await supabase.from("pricing")
      .update({ agreement_status: "agreed", payment_terms: terms, priced_by: me.id })
      .eq("id", existing.id);
  } else {
    await supabase.from("pricing").insert({
      visit_id: visitId, agreement_status: "agreed", payment_terms: terms, priced_by: me.id,
    });
  }
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  revalidatePath("/owner/approvals");
  revalidatePath("/owner");
}

// Owner approves the manager's price → finalizes every line + releases to
// accounting (#1/#5). Reject sends it back to the manager to re-price.
export async function approvePricing(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("approve_pricing", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
  revalidatePath("/owner");
}
export async function rejectPricing(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("reject_pricing", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
}

export async function unsettleLine(formData: FormData): Promise<void> { await lineAction(formData, "unsettle_line"); }
export async function resettleLine(formData: FormData): Promise<void> { await lineAction(formData, "resettle_line"); }
export async function removeLineAsManager(formData: FormData): Promise<void> { await lineAction(formData, "remove_line"); }

// QC records / updates the XRF result for a line. `submit` marks it final;
// once every line is submitted the visit auto-advances to pricing.
export async function recordXrf(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "qc") return; // XRF is read-only for everyone else, incl. owner

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const result = String(formData.get("result") ?? "").trim() || null;
  let submitted = String(formData.get("submitted") ?? "") === "true";
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  const weightKg = weightRaw === "" ? null : Number(weightRaw);
  if (!lineId) return;

  // Submitting requires the XRF result to be entered and the QC analyst to
  // confirm the entries are correct; otherwise it is kept as a draft.
  if (submitted && (!result || formData.get("confirm") == null)) {
    submitted = false;
  }

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

// Owner finalizes a line's price — the manager can no longer change it
// (enforced by the DB trigger; this is the UI entry point).
export async function finalizeLinePrice(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return;
  const supabase = await createClient();
  await supabase.from("visit_materials").update({ price_finalized: true }).eq("id", lineId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
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
