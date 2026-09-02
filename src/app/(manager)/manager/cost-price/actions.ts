"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { canUseCostPrice } from "@/lib/auth/require-cost-price";

// A plain saved computation (sells nothing) when `sell` is falsy; a mixing batch
// submitted for OWNER APPROVAL when `sell` is "1" — the lots stay in stock until
// the owner approves (the approval trigger then removes them).
export async function createCostPriceRun(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner", "inventory"].includes(me.role)) return fail("Not authorized.");

  const label = String(formData.get("label") ?? "").trim();
  const sell = String(formData.get("sell") ?? "") === "1";
  const lotIds = [...new Set(formData.getAll("lot_ids").map(String).filter(Boolean))];
  // External (non-stock) materials mixed in — parallel arrays from the form.
  const exNames = formData.getAll("extra_name").map(String);
  const exWeights = formData.getAll("extra_weight").map(String);
  const exCosts = formData.getAll("extra_cost").map(String);
  const extras = exNames
    .map((name, i) => ({ material_name: name.trim(), weight_kg: Number(exWeights[i]), cost_price_per_kg: Number(exCosts[i] || 0) }))
    .filter((e) => e.material_name && e.weight_kg > 0);
  if (!label) return fail("Give the batch a label.");
  if (lotIds.length === 0 && extras.length === 0) return fail("Add at least one stock lot or external material.");
  // A sale must move real stock — external-only batches can only be saved.
  if (sell && lotIds.length === 0) return fail("A sale needs at least one stocked lot to remove; save it as a computation instead.");

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const { data: firstLot } = lotIds.length
    ? await supabase.from("stock_lots").select("site_id, material_type_id").eq("id", lotIds[0]).maybeSingle()
    : { data: null };

  const siteId = (profile?.site_id as string | null) ?? (firstLot?.site_id as string | null) ?? null;
  if (!siteId) return fail("No site to anchor this batch to.");

  const { data: run, error } = await supabase
    .from("cost_price_runs")
    .insert({
      site_id: siteId,
      label,
      material_type_id: (firstLot?.material_type_id as string | null) ?? null,
      approval_status: sell ? "pending" : null,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error || !run) return fail(error?.message?.replace(/^.*?:\s*/, "") ?? "Couldn't create the batch.");

  // Attach lots + extras; roll back the run if either fails so no empty/partial
  // batch is left behind.
  if (lotIds.length) {
    const { error: linkErr } = await supabase
      .from("cost_price_run_lots")
      .insert(lotIds.map((id) => ({ run_id: run.id as string, stock_lot_id: id })));
    if (linkErr) {
      await supabase.from("cost_price_runs").delete().eq("id", run.id);
      return fail(`Couldn't attach the lots — nothing was saved. ${linkErr.message.replace(/^.*?:\s*/, "")}`);
    }
  }
  if (extras.length) {
    const { error: exErr } = await supabase
      .from("cost_price_run_extras")
      .insert(extras.map((e) => ({ run_id: run.id as string, ...e })));
    if (exErr) {
      await supabase.from("cost_price_runs").delete().eq("id", run.id);
      return fail(`Couldn't add the external materials — nothing was saved. ${exErr.message.replace(/^.*?:\s*/, "")}`);
    }
  }

  revalidateCostPages();
  return ok(sell ? "Batch formed — sent for owner approval." : "Computation saved.");
}

// ─── Editing a computed run (until it is sold) ───────────────────────────────
// RLS blocks every one of these on an APPROVED (sold) batch; the weighted cost
// price recomputes automatically via the DB triggers.

const canEditRuns = canUseCostPrice;

function revalidateCostPages() {
  revalidatePath("/manager/cost-price");
  revalidatePath("/inventory/cost-price");
  revalidatePath("/owner/cost-batches");
}

// Rename a saved computation.
export async function renameCostPriceRun(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!canEditRuns(me)) return fail("Not authorized.");
  const id = String(formData.get("run_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!id) return fail("Missing batch.");
  if (!label) return fail("Give the batch a label.");
  const supabase = await createClient();
  const res = await supabase.from("cost_price_runs").update({ label }).eq("id", id).select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  if (!res.data?.length) return fail("Couldn't edit this batch — it may already be sold.");
  revalidateCostPages();
  return ok("Batch renamed.");
}

// Drop a stocked lot out of the mix (it stays in stock).
export async function removeRunLot(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!canEditRuns(me)) return;
  const runId = String(formData.get("run_id") ?? "");
  const lotId = String(formData.get("stock_lot_id") ?? "");
  if (!runId || !lotId) return;
  const supabase = await createClient();
  await supabase.from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", lotId);
  revalidateCostPages();
}

// Add an external (non-stock) material to an existing computation.
export async function addRunExtra(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!canEditRuns(me)) return fail("Not authorized.");
  const runId = String(formData.get("run_id") ?? "");
  const name = String(formData.get("material_name") ?? "").trim();
  const weight = Number(formData.get("weight_kg"));
  const cost = Number(formData.get("cost_price_per_kg") || 0);
  if (!runId) return fail("Missing batch.");
  if (!name) return fail("Name the material.");
  if (!(weight > 0)) return fail("Weight must be greater than zero.");
  if (!(cost >= 0)) return fail("Cost can't be negative.");
  const supabase = await createClient();
  const { error } = await supabase.from("cost_price_run_extras")
    .insert({ run_id: runId, material_name: name, weight_kg: weight, cost_price_per_kg: cost });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidateCostPages();
  return ok("Material added.");
}

// Correct an external material's weight / cost.
export async function updateRunExtra(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!canEditRuns(me)) return fail("Not authorized.");
  const id = String(formData.get("extra_id") ?? "");
  const name = String(formData.get("material_name") ?? "").trim();
  const weight = Number(formData.get("weight_kg"));
  const cost = Number(formData.get("cost_price_per_kg") || 0);
  if (!id) return fail("Missing material.");
  if (!name) return fail("Name the material.");
  if (!(weight > 0)) return fail("Weight must be greater than zero.");
  if (!(cost >= 0)) return fail("Cost can't be negative.");
  const supabase = await createClient();
  const res = await supabase.from("cost_price_run_extras")
    .update({ material_name: name, weight_kg: weight, cost_price_per_kg: cost }).eq("id", id).select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  if (!res.data?.length) return fail("Couldn't edit — the batch may already be sold.");
  revalidateCostPages();
  return ok("Material updated.");
}

export async function removeRunExtra(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!canEditRuns(me)) return;
  const id = String(formData.get("extra_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("cost_price_run_extras").delete().eq("id", id);
  revalidateCostPages();
}

// Delete a cost-price computation (or a pending/rejected batch). RLS blocks
// deleting an APPROVED (sold) batch. Owner / general manager / inventory only.
export async function deleteCostPriceRun(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!canEditRuns(me)) return;
  const id = String(formData.get("run_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("cost_price_runs").delete().eq("id", id);
  revalidateCostPages();
}
