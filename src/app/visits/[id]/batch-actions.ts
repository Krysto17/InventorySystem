"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";
import { DELETE_BATCH_ROLES, ROLE_HOME } from "@/lib/auth/roles";

// Delete an entire batch supply (#4/#5). Four roles have a path to this and the
// delete_batch RPC (0142) decides which of them may remove THIS batch right now:
// the owner until it is paid, any manager on their own site until the owner has
// approved it, processing while the visit is still in processing, receiving
// until a settlement exists. This gate only turns away the roles with no path at
// all — duplicating the RPC's conditions here is how they drift apart.
export async function deleteBatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (!DELETE_BATCH_ROLES.includes(me.role)) return fail("Not allowed to delete batches.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing batch.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_batch", { p_visit_id: visitId });
  // The RPC raises when the gate refuses (already approved, already paid, wrong
  // site). Redirecting to the dashboard on that path told the user the batch was
  // gone when it was still there.
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/manager");
  revalidatePath("/owner");
  // Send them to their OWN dashboard. Processing and receiving may delete too,
  // and the proxy would bounce them straight back off /manager.
  const home = ROLE_HOME[me.role];
  revalidatePath(home);
  redirect(home);
}

// Receiving adds a material line to an in_receiving batch. The general (New-Site)
// manager runs the receiving module too; any manager may also add a missing line
// while pricing (RLS enforces state = pricing for a site manager).
export async function addMaterialLine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "receiving" && me.role !== "owner" && me.role !== "manager" && !me.is_general_manager) {
    return fail("Not allowed to add a material line.");
  }

  const visitId = String(formData.get("visit_id") ?? "");
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const weight = Number(formData.get("weight_kg"));
  if (!visitId || !materialTypeId || !(weight >= 0)) return fail("Pick a material and enter a weight.");

  const magnetic = String(formData.get("magnetic_analysis") ?? "").trim() || null;
  const comment = String(formData.get("receiving_comment") ?? "").trim() || null;
  const requiresAnalysis = formData.get("requires_analysis") != null;

  const supabase = await createClient();
  // .select() so a refused write comes back as zero rows rather than silence —
  // the batch locks once the next stage acts, and the clerk must be told.
  const res = await supabase.from("visit_materials").insert({
    visit_id: visitId,
    material_type_id: materialTypeId,
    weight_kg: weight,
    magnetic_analysis: magnetic,
    receiving_comment: comment,
    requires_analysis: requiresAnalysis,
    recorded_by: me.id,
  }).select("id");
  const result = fromWrite(res, "That line was not added — the batch may have moved on to the next stage.");
  if (!result.ok) return result;
  revalidatePath(`/visits/${visitId}`);
  return ok("Line added.");
}

// Receiving edits a line's weight / magnetic / comment before sending to QC.
// Receiving corrects a draft line (in receiving); the manager may also correct
// any batch line (e.g. a kg fix) while the visit is still open — RLS enforces
// the manager's own site + open state.
export async function updateMaterialLine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "receiving" && me.role !== "manager" && me.role !== "owner") {
    return fail("Not allowed to edit a material line.");
  }

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const weight = Number(formData.get("weight_kg"));
  if (!lineId || !(weight >= 0)) return fail("Enter a weight.");
  const materialTypeId = String(formData.get("material_type_id") ?? "").trim();
  const magnetic = String(formData.get("magnetic_analysis") ?? "").trim() || null;
  const comment = String(formData.get("receiving_comment") ?? "").trim() || null;

  const patch: Record<string, unknown> = {
    weight_kg: weight, magnetic_analysis: magnetic, receiving_comment: comment,
  };
  if (materialTypeId) patch.material_type_id = materialTypeId;

  const supabase = await createClient();
  // Receiving's lines lock the moment QC starts. RLS then matches no row and
  // answers `error: null, data: []`, so only .select() can tell us it was refused.
  const res = await supabase.from("visit_materials")
    .update(patch as never).eq("id", lineId).select("id");
  const result = fromWrite(res, "That line was not changed — it may be locked because the batch has moved on.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Line updated.");
}

// Receiving deletes a draft material line while the visit is in receiving; the
// general manager may too.
export async function deleteMaterialLine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "receiving" && me.role !== "owner" && !me.is_general_manager) {
    return fail("Not allowed to remove a material line.");
  }

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return fail("Missing line.");

  const supabase = await createClient();
  const res = await supabase.from("visit_materials").delete().eq("id", lineId).select("id");
  const result = fromWrite(res, "That line was not removed — it may be locked because the batch has moved on.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Line removed.");
}

// Receiving's material lines are saved as drafts while the visit is in
// receiving (editable any time); this submits the batch for analysis — straight
// to QC, or to pricing when no line needs analysis (no manager gate, #3).
export async function submitToManager(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing batch.");
  const supabase = await createClient();
  // The RPC raises when it refuses (wrong state, wrong site, no lines).
  const { error } = await supabase.rpc("submit_visit_to_manager", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  revalidatePath("/qc");
  return ok("Batch sent for analysis.");
}

// Manager bypasses XRF analysis from in_qc → pricing (price without XRF, #3).
export async function skipToPricing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "manager" && me.role !== "owner") return fail("Only a manager or the owner can skip analysis.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing batch.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("manager_skip_to_pricing", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  revalidatePath("/qc");
  return ok("Sent to pricing without analysis.");
}

// A line that fails spec/pricing — manager (own site) or owner. Three outcomes:
// unsettle (keep + gate pass + exclude from total), re-settle (reverse), remove.
//
// Receiving handles the material and spots a failure first, so they may unsettle
// on their own site; the RPC raises their gate pass as PENDING for a manager to
// authorise. Putting a line back, or deleting one outright, changes what the
// batch is worth and stays with the manager.
// One implementation; the three exported wrappers below just pass the verb and
// hand back whatever it decides, so a refusal reaches the caller either way.
async function lineAction(
  formData: FormData, rpc: "unsettle_line" | "resettle_line" | "remove_line",
): Promise<ActionResult> {
  const me = await getProfile();
  const allowed = me?.role === "manager" || me?.role === "owner"
    || (me?.role === "receiving" && rpc === "unsettle_line");
  if (!me) return fail("Not signed in.");
  if (!allowed) return fail("Not allowed to change this line.");
  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return fail("Missing line.");
  const supabase = await createClient();
  // Each RPC raises when it refuses — an unsettled line that is already
  // unsettled, a batch the owner has approved, the wrong site.
  const { error } = rpc === "unsettle_line"
    ? await supabase.rpc("unsettle_line", {
        p_line_id: lineId,
        p_reason: String(formData.get("reason") ?? "").trim() || undefined,
      })
    : await supabase.rpc(rpc, { p_line_id: lineId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  // Releases are raised from the analyses screens too.
  revalidatePath("/owner/analyses");
  revalidatePath("/manager/analyses");
  return ok(rpc === "unsettle_line" ? "Line unsettled."
    : rpc === "resettle_line" ? "Line put back." : "Line removed.");
}

// Manager/owner submits the priced batch to the owner for approval: records an
// "agreed" pricing agreement (amount comes from the priced lines) which moves
// the visit to awaiting_price_approval (Pricing node → green).
export async function submitPricedBatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "manager" && me.role !== "owner") return fail("Only a manager or the owner can submit a price.");
  const visitId = String(formData.get("visit_id") ?? "");
  const terms = String(formData.get("payment_terms") ?? "").trim();
  if (!visitId) return fail("Missing batch.");
  if (!terms) return fail("Say what the payment terms are.");

  const supabase = await createClient();
  // Need at least one priced line (the batch total is the sum of line prices).
  // This is a real business refusal, not an error — it was returning silently,
  // so the manager pressed submit and nothing at all happened.
  const { count } = await supabase
    .from("visit_materials")
    .select("id", { count: "exact", head: true })
    .eq("visit_id", visitId)
    .not("unit_price", "is", null);
  if (!count) return fail("Price at least one line before submitting.");

  const { data: existing } = await supabase.from("pricing").select("id").eq("visit_id", visitId).maybeSingle();
  // Both branches ask for the row back: the update is the one RLS can refuse
  // silently, and treating them alike keeps the two paths honest.
  const res = existing
    ? await supabase.from("pricing")
        .update({ agreement_status: "agreed", payment_terms: terms, priced_by: me.id })
        .eq("id", existing.id).select("id")
    : await supabase.from("pricing").insert({
        visit_id: visitId, agreement_status: "agreed", payment_terms: terms, priced_by: me.id,
      }).select("id");
  const result = fromWrite(res, "The price was not submitted — the batch may already be with the owner.");
  if (!result.ok) return result;
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  revalidatePath("/owner/approvals");
  revalidatePath("/owner");
  return ok("Price sent to the owner for approval.");
}

// Owner approves the manager's price → finalizes every line + releases to
// accounting (#1/#5). Reject sends it back to the manager to re-price.
export async function approvePricing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "owner") return fail("Only the owner can approve pricing.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing batch.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_pricing", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
  revalidatePath("/owner");
  return ok("Pricing approved.");
}
export async function rejectPricing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "owner") return fail("Only the owner can reject pricing.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing batch.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_pricing", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
  return ok("Sent back to the manager to re-price.");
}

export async function unsettleLine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return lineAction(formData, "unsettle_line");
}
export async function resettleLine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return lineAction(formData, "resettle_line");
}
export async function removeLineAsManager(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return lineAction(formData, "remove_line");
}

// QC records / updates the XRF result for a line. `submit` marks it final;
// once every line is submitted the visit auto-advances to pricing.
export async function recordXrf(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  // XRF is read-only for everyone else, incl. owner
  if (me.role !== "qc") return fail("Only QC can record an XRF result.");

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const result = String(formData.get("result") ?? "").trim() || null;
  let submitted = String(formData.get("submitted") ?? "") === "true";
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  const weightKg = weightRaw === "" ? null : Number(weightRaw);
  if (!lineId) return fail("Missing line.");

  const supabase = await createClient();

  // A line marked "no analysis required" still passes through QC to be weighed,
  // so it is confirmed with a weight and no XRF result. Every other line needs
  // the result typed in before it can be submitted.
  const { data: line } = await supabase
    .from("visit_materials").select("requires_analysis").eq("id", lineId).maybeSingle();
  const exempt = line != null && line.requires_analysis === false;

  // Submitting always needs the QC analyst to confirm the entries are correct.
  if (submitted && formData.get("confirm") == null) submitted = false;
  if (submitted && !exempt && !result) submitted = false;
  if (submitted && exempt && weightKg == null) submitted = false;
  // Upsert one XRF record per line (visit_material_id is unique).
  const { data: existing } = await supabase
    .from("xrf_records")
    .select("id")
    .eq("visit_material_id", lineId)
    .maybeSingle();

  // The two branches fail DIFFERENTLY, which is why both are checked the same
  // way: outside the QC window an INSERT raises (RLS with-check), while an
  // UPDATE simply matches no row and answers `error: null, data: []`. Reproduced
  // both ways — the update branch is where a typed-in result vanished silently.
  const res = existing
    ? await supabase.from("xrf_records")
        .update({ result, submitted, weight_kg: weightKg })
        .eq("id", existing.id).select("id")
    : await supabase.from("xrf_records").insert({
        visit_material_id: lineId, result, submitted, weight_kg: weightKg, recorded_by: me.id,
      }).select("id");
  const written = fromWrite(res, "That analysis was not saved — the batch has moved past QC.");
  if (!written.ok) return written;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/qc");
  return ok(submitted ? "Analysis submitted." : "Analysis saved.");
}

// Owner finalizes a line's price — the manager can no longer change it
// (enforced by the DB trigger; this is the UI entry point).
export async function finalizeLinePrice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "owner") return fail("Only the owner can finalize a price.");
  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  if (!lineId) return fail("Missing line.");
  const supabase = await createClient();
  const res = await supabase.from("visit_materials")
    .update({ price_finalized: true }).eq("id", lineId).select("id");
  const result = fromWrite(res, "That price was not finalized — the line may already be locked.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Price finalized.");
}

// Owner marks a line's price as AGREED — the signal the manager waits for
// before forwarding the details for payment. The price stays editable; the DB
// enforces owner-only and stamps who/when.
export async function setPriceAgreed(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "owner") return fail("Only the owner can agree a price.");
  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const agreed = String(formData.get("agreed") ?? "") === "1";
  if (!lineId) return fail("Missing line.");
  const supabase = await createClient();
  const res = await supabase.from("visit_materials")
    .update({ price_agreed: agreed }).eq("id", lineId).select("id");
  const result = fromWrite(res, "That price was not changed — the line may already be locked.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/analyses");
  revalidatePath("/manager/analyses");
  revalidatePath("/manager");
  return ok(agreed ? "Price agreed." : "Agreement withdrawn.");
}

// Manager / owner assigns the optional per-line price.
export async function setLinePrice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "manager" && me.role !== "owner") return fail("Only a manager or the owner can set a price.");

  const visitId = String(formData.get("visit_id") ?? "");
  const lineId = String(formData.get("visit_material_id") ?? "");
  const priceRaw = String(formData.get("unit_price") ?? "").trim();
  if (!lineId) return fail("Missing line.");
  const unitPrice = priceRaw === "" ? null : Number(priceRaw);

  const supabase = await createClient();
  // A finalized line is locked by a DB trigger, and an owner-approved batch by
  // RLS — both come back as zero rows, which is what used to be swallowed here.
  const res = await supabase
    .from("visit_materials")
    .update({ unit_price: unitPrice, priced_by: me.id })
    .eq("id", lineId).select("id");
  const result = fromWrite(res, "That price was not saved — the line may be finalized or the batch already approved.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok(unitPrice == null ? "Price cleared." : "Price saved.");
}
