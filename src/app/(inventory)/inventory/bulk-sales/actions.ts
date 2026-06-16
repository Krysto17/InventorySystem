"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export async function createBulkSale(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "inventory" && me.role !== "manager" && me.role !== "owner") return;

  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const buyerName = String(formData.get("buyer_name") ?? "").trim();
  const buyerPhone = String(formData.get("buyer_phone") ?? "").trim() || null;
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const weight = Number(formData.get("weight"));
  const unitPrice = Number(formData.get("unit_price"));

  if (!materialTypeId || !buyerName) return;
  if (!(weight > 0) || !(unitPrice > 0)) return;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("site_id")
    .eq("id", me.id)
    .single();

  const siteId = profile?.site_id as string | null;
  if (!siteId) return;

  await supabase.from("bulk_sales").insert({
    site_id: siteId,
    buyer_name: buyerName,
    buyer_phone: buyerPhone,
    material_type_id: materialTypeId,
    grade,
    weight,
    unit_price: unitPrice,
    recorded_by: me.id,
  });

  revalidatePath("/inventory/bulk-sales");
  revalidatePath("/owner");
}

export async function approveBulkSale(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("bulk_sales")
    .update({
      approval_status: "approved",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("approval_status", "pending");

  revalidatePath("/owner");
  revalidatePath("/inventory/bulk-sales");
}

export async function rejectBulkSale(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("rejection_note") ?? "").trim() || null;
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("bulk_sales")
    .update({
      approval_status: "rejected",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      rejection_note: note,
    })
    .eq("id", id)
    .eq("approval_status", "pending");

  revalidatePath("/owner");
  revalidatePath("/inventory/bulk-sales");
}
