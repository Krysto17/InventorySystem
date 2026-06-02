"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export async function createConsumable(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "inventory" && me.role !== "owner") return;

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const initialStock = Number(formData.get("on_hand") ?? 0);
  if (!name) return;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("site_id")
    .eq("id", me.id)
    .single();

  const siteId = profile?.site_id as string | null;
  if (!siteId) return;

  await supabase.from("consumables").insert({
    site_id: siteId,
    name,
    unit,
    on_hand: initialStock >= 0 ? initialStock : 0,
  });

  revalidatePath("/inventory/consumables");
}

export async function recordConsumableMovement(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (me.role !== "inventory" && me.role !== "owner") return;

  const consumableId = String(formData.get("consumable_id") ?? "");
  const deltaRaw = Number(formData.get("delta"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!consumableId || deltaRaw === 0) return;

  const supabase = await createClient();

  // Guard: consumption would push on_hand negative
  if (deltaRaw < 0) {
    const { data: c } = await supabase
      .from("consumables")
      .select("on_hand")
      .eq("id", consumableId)
      .single();
    if (!c || Number(c.on_hand) + deltaRaw < 0) return;
  }

  await supabase.from("consumable_movements").insert({
    consumable_id: consumableId,
    delta: deltaRaw,
    recorded_by: me.id,
    reason,
  });

  revalidatePath("/inventory/consumables");
}
