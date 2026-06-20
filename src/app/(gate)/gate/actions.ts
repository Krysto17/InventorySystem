"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

async function mySiteId(): Promise<string | null> {
  const me = await getProfile();
  if (!me) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  return (data?.site_id as string | null) ?? null;
}

// The gate registers material moving in/out at the gate.
export async function recordGateLog(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "gate" && me.role !== "owner")) return;
  const siteId = await mySiteId();
  if (!siteId) return;

  const direction = String(formData.get("direction") ?? "");
  if (!["in", "out"].includes(direction)) return;
  const bagsRaw = String(formData.get("bags") ?? "").trim();
  const gatePassId = String(formData.get("gate_pass_id") ?? "") || null;

  const supabase = await createClient();
  await supabase.from("gate_logs").insert({
    site_id: siteId,
    direction,
    driver_name: String(formData.get("driver_name") ?? "").trim() || null,
    driver_phone: String(formData.get("driver_phone") ?? "").trim() || null,
    bags: bagsRaw === "" ? null : Number(bagsRaw),
    material_owner: String(formData.get("material_owner") ?? "").trim() || null,
    reason: String(formData.get("reason") ?? "").trim() || null,
    gate_pass_id: gatePassId,
    recorded_by: me.id,
  });
  revalidatePath("/gate");
}

// The gate acknowledges a manager/owner-issued gate pass before release. If the
// pass is tied to a stock lot, the DB trigger writes the stock 'out' movement.
export async function acknowledgeGatePass(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "gate") return;
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("gate_passes").update({ status: "acknowledged" }).eq("id", id);
  revalidatePath("/gate");
}
