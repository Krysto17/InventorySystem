"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Manager (or owner) issues a gate pass authorising outgoing material; Security
// acknowledges it before release.
export async function issueGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId) return;

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const materialTypeId = String(formData.get("material_type_id") ?? "") || null;
  const bagsRaw = String(formData.get("bags") ?? "").trim();
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();

  await supabase.from("gate_passes").insert({
    site_id: siteId,
    supplier_id: supplierId,
    material_owner: String(formData.get("material_owner") ?? "").trim() || null,
    material_type_id: materialTypeId,
    bags: bagsRaw === "" ? null : Number(bagsRaw),
    weight_kg: weightRaw === "" ? null : Number(weightRaw),
    reason,
    issued_by: me.id,
  });
  revalidatePath("/manager/gate-passes");
}

export async function cancelGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("gate_passes").update({ status: "cancelled" }).eq("id", id);
  revalidatePath("/manager/gate-passes");
}
