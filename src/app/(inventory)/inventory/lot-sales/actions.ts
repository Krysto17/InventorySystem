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

// Inventory registers a stock lot (supplier + material + weight + cost price).
export async function createStockLot(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "inventory" && me.role !== "owner")) return;

  const siteId = await mySiteId();
  if (!siteId) return;
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const weight = Number(formData.get("weight_kg"));
  const cost = String(formData.get("cost_price_per_kg") ?? "").trim();
  if (!materialTypeId || !(weight > 0)) return;

  const supabase = await createClient();
  await supabase.from("stock_lots").insert({
    site_id: siteId,
    material_type_id: materialTypeId,
    supplier_id: supplierId,
    weight_kg: weight,
    cost_price_per_kg: cost === "" ? null : Number(cost),
    recorded_by: me.id,
  });
  revalidatePath("/inventory/lot-sales");
}

// Inventory creates a pending lot sale from selected available lots.
export async function createLotSale(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "inventory" && me.role !== "owner")) return;

  const buyerName = String(formData.get("buyer_name") ?? "").trim();
  const buyerPhone = String(formData.get("buyer_phone") ?? "").trim() || null;
  const lotIds = formData.getAll("lot_ids").map(String).filter(Boolean);
  if (!buyerName || lotIds.length === 0) return;

  const supabase = await createClient();
  // Derive site + material from the first selected lot; the DB trigger enforces
  // that every other selected lot matches.
  const { data: firstLot } = await supabase
    .from("stock_lots")
    .select("site_id, material_type_id, status")
    .eq("id", lotIds[0])
    .single();
  if (!firstLot || firstLot.status !== "available") return;

  const { data: sale, error } = await supabase
    .from("lot_sales")
    .insert({
      site_id: firstLot.site_id,
      material_type_id: firstLot.material_type_id,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      recorded_by: me.id,
    })
    .select("id")
    .single();
  if (error || !sale) return;

  for (const lotId of lotIds) {
    const { error: itemErr } = await supabase
      .from("lot_sale_items")
      .insert({ lot_sale_id: sale.id, stock_lot_id: lotId });
    // If a lot fails the guard (wrong material/already sold), roll the sale back.
    if (itemErr) {
      await supabase.from("lot_sales").delete().eq("id", sale.id);
      return;
    }
  }
  revalidatePath("/inventory/lot-sales");
}

export async function setLotSaleApproval(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return; // owner approves bulk sales
  const saleId = String(formData.get("lot_sale_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!saleId || !["approved", "rejected"].includes(decision)) return;

  const supabase = await createClient();
  await supabase
    .from("lot_sales")
    .update({ approval_status: decision, rejection_note: decision === "rejected" ? "Rejected by owner" : null })
    .eq("id", saleId);
  revalidatePath("/inventory/lot-sales");
  revalidatePath("/owner");
}
