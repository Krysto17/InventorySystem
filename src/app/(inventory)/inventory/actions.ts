"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type IntakeState = { error?: string };

export async function recordPurchaseIntake(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "inventory" && me.role !== "manager" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const weight = Number(formData.get("weight"));
  if (!(weight > 0)) return { error: "Weight must be greater than 0" };

  const grade = String(formData.get("grade") ?? "").trim() || null;

  const supabase = await createClient();

  // Fetch visit to get site_id + material_type_id + state (prevent state tampering from form)
  const { data: visit } = await supabase
    .from("visits")
    .select("site_id, declared_material_type_id, state")
    .eq("id", visitId)
    .single();

  if (!visit) return { error: "Visit not found" };
  if (visit.state !== "awaiting_stock_intake")
    return { error: "Visit is not awaiting stock intake" };

  const { error } = await supabase.from("stock_movements").insert({
    site_id: visit.site_id,
    material_type_id: visit.declared_material_type_id,
    grade,
    weight,
    direction: "in",
    reason: "purchase_intake",
    recorded_by: me.id,
    ref_visit_id: visitId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/inventory");
  return {};
}

export async function recordAdjustment(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "owner") return { error: "Only owner can record adjustments" };

  const siteId = String(formData.get("site_id") ?? "");
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const weight = Number(formData.get("weight"));
  const direction = String(formData.get("direction") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!siteId || !materialTypeId) return { error: "Missing site or material type" };
  if (!(weight > 0)) return { error: "Weight must be greater than 0" };
  if (direction !== "in" && direction !== "out") return { error: "Invalid direction" };

  const supabase = await createClient();
  const { error } = await supabase.from("stock_movements").insert({
    site_id: siteId,
    material_type_id: materialTypeId,
    grade,
    weight,
    direction,
    reason: "adjustment",
    recorded_by: me.id,
    ref_visit_id: null,
  });

  if (error) return { error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/owner");
  return {};
}
