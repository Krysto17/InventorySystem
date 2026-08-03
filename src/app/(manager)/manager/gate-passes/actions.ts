"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Manager (or owner) issues a gate pass authorising outgoing material; the gate
// acknowledges it before release. A pass can be tied to an available stock lot
// (traceable back to receiving) — on acknowledgement that lot leaves stock.
export async function issueGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner", "receiving"].includes(me.role)) return;
  // Receiving raises a request; it carries no authority until a manager signs
  // it off. Manager/owner passes are authorised on the spot.
  const isRequest = me.role === "receiving";

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId) return;

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const stockLotId = String(formData.get("stock_lot_id") ?? "") || null;
  let supplierId = String(formData.get("supplier_id") ?? "") || null;
  let materialTypeId = String(formData.get("material_type_id") ?? "") || null;
  const bagsRaw = String(formData.get("bags") ?? "").trim();
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  let weightKg = weightRaw === "" ? null : Number(weightRaw);

  // When a lot is chosen, default the material / supplier / weight from it so
  // the released quantity matches what is actually in stock.
  if (stockLotId) {
    const { data: lot } = await supabase
      .from("stock_lots")
      .select("material_type_id, supplier_id, weight_kg, site_id, status")
      .eq("id", stockLotId)
      .single();
    if (!lot || lot.status !== "available" || lot.site_id !== siteId) return;
    materialTypeId = materialTypeId ?? (lot.material_type_id as string);
    supplierId = supplierId ?? (lot.supplier_id as string | null);
    weightKg = weightKg ?? Number(lot.weight_kg);
  }

  await supabase.from("gate_passes").insert({
    site_id: siteId,
    supplier_id: supplierId,
    material_owner: String(formData.get("material_owner") ?? "").trim() || null,
    material_type_id: materialTypeId,
    stock_lot_id: stockLotId,
    bags: bagsRaw === "" ? null : Number(bagsRaw),
    weight_kg: weightKg,
    reason,
    issued_by: me.id,
    ...(isRequest
      ? { status: "pending", requested_by: me.id }
      : { status: "issued", authorized_by: me.id, authorized_at: new Date().toISOString() }),
  });
  revalidatePath("/manager/gate-passes");
  revalidatePath("/receiving");
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

// Manager (or owner) authorises a gate pass raised by receiving — only then is
// it valid at the gate. The RPC re-checks the role, site and pending status.
export async function authorizeGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return;
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.rpc("authorize_gate_pass", { p_pass_id: id });
  revalidatePath("/manager/gate-passes");
  revalidatePath("/receiving");
}
