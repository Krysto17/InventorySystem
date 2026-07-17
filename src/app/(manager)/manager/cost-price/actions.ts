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
  if (!label) return fail("Give the batch a label.");
  if (lotIds.length === 0) return fail("Select at least one stock lot.");

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const { data: firstLot } = await supabase
    .from("stock_lots").select("site_id, material_type_id").eq("id", lotIds[0]).maybeSingle();

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

  // Attach all lots in one insert; roll back the run if it fails so no empty
  // batch is left behind.
  const { error: linkErr } = await supabase
    .from("cost_price_run_lots")
    .insert(lotIds.map((id) => ({ run_id: run.id as string, stock_lot_id: id })));
  if (linkErr) {
    await supabase.from("cost_price_runs").delete().eq("id", run.id);
    return fail(`Couldn't attach the lots — nothing was saved. ${linkErr.message.replace(/^.*?:\s*/, "")}`);
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
