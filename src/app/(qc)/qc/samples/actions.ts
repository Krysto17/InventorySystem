"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

export type SampleState = { error?: string; ok?: string };

// QC records a standalone sample analysis (no visit): supplier + result, plus
// optional material/weight. Every row is inherently a "sample".
export async function addSample(_prev: SampleState, formData: FormData): Promise<SampleState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "qc" && me.role !== "owner") return { error: "Forbidden" };
  if (!me.site_id) return { error: "Your account has no site" };

  const supplierName = String(formData.get("supplier_name") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();
  if (!supplierName) return { error: "Supplier name is required" };
  if (!result) return { error: "Result is required" };

  const supplierId = String(formData.get("supplier_id") ?? "").trim() || null;
  const materialTypeId = String(formData.get("material_type_id") ?? "").trim() || null;
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  const weight = weightRaw ? Number(weightRaw) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("sample_analyses").insert({
    site_id: me.site_id,
    supplier_id: supplierId,
    supplier_name: supplierName,
    material_type_id: materialTypeId,
    weight_kg: weight != null && weight >= 0 ? weight : null,
    result,
    recorded_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/qc/samples");
  return { ok: `Sample for ${supplierName} recorded.` };
}

// Owner or general manager attaches a flat price to a sample.
//
// /manager/samples renders the price box for EVERY manager, but only the owner
// and the general manager may actually price — so a site manager pressing "Set"
// was refused here and told nothing at all. The authorization is unchanged;
// what changes is that the refusal now says so instead of looking like a box
// that quietly forgets what was typed. RLS refuses the same set by matching no
// rows, which is equally silent.
export async function setSamplePrice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "owner" && !me.is_general_manager) {
    return fail("Only the owner or the general manager can price a sample.");
  }
  const sampleId = String(formData.get("sample_id") ?? "");
  const price = Number(formData.get("price"));
  if (!sampleId) return fail("Missing sample.");
  if (!(price >= 0)) return fail("Enter a price of zero or more.");
  const supabase = await createClient();
  const res = await supabase.from("sample_analyses")
    .update({ price, priced_by: me.id }).eq("id", sampleId).select("id");
  const result = fromWrite(res, "That sample was not priced — you may not have permission for it.");
  if (!result.ok) return result;
  revalidatePath("/qc/samples");
  revalidatePath("/owner/analyses");
  revalidatePath("/manager/analyses");
  return ok("Price saved.");
}

// QC deletes its own unpriced sample; owner may delete any.
//
// RLS is the boundary here and stays untouched: `is_owner() OR (qc AND
// recorded_by = auth.uid() AND price IS NULL)`. The QC samples screen lists
// every analyst's work and offers Delete on any unpriced row, so deleting a
// colleague's sample is refused with no error and no rows — verified. The row
// simply stayed put with nothing said.
export async function deleteSample(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  const sampleId = String(formData.get("sample_id") ?? "");
  if (!sampleId) return fail("Missing sample.");
  const supabase = await createClient();
  const res = await supabase.from("sample_analyses").delete().eq("id", sampleId).select("id");
  const result = fromWrite(res, "That sample was not deleted — it may already be priced, or recorded by another analyst.");
  if (!result.ok) return result;
  revalidatePath("/qc/samples");
  return ok("Sample deleted.");
}
