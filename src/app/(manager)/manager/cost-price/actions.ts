"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

// A plain saved computation (sells nothing) when `sell` is falsy; a mixing batch
// submitted for OWNER APPROVAL when `sell` is "1" — the lots stay in stock until
// the owner approves (the approval trigger then removes them).
export async function createCostPriceRun(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not authorized.");

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

  revalidatePath("/manager/cost-price");
  revalidatePath("/owner/cost-batches");
  return ok(sell ? "Batch formed — sent for owner approval." : "Computation saved.");
}

// Delete a cost-price computation (or a pending/rejected batch). RLS blocks
// deleting an APPROVED (sold) batch. Owner / general manager only.
export async function deleteCostPriceRun(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return;
  const id = String(formData.get("run_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("cost_price_runs").delete().eq("id", id);
  revalidatePath("/manager/cost-price");
  revalidatePath("/owner/cost-batches");
}
