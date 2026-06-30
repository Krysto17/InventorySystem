"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

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
export async function setSamplePrice(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "owner" && !me.is_general_manager) return;
  const sampleId = String(formData.get("sample_id") ?? "");
  const price = Number(formData.get("price"));
  if (!sampleId || !(price >= 0)) return;
  const supabase = await createClient();
  await supabase.from("sample_analyses").update({ price, priced_by: me.id }).eq("id", sampleId);
  revalidatePath("/qc/samples");
  revalidatePath("/owner/analyses");
  revalidatePath("/manager/analyses");
}

// QC deletes its own unpriced sample; owner may delete any.
export async function deleteSample(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  const sampleId = String(formData.get("sample_id") ?? "");
  if (!sampleId) return;
  const supabase = await createClient();
  await supabase.from("sample_analyses").delete().eq("id", sampleId);
  revalidatePath("/qc/samples");
}
