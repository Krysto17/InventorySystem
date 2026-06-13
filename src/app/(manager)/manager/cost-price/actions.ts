"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export async function createCostPriceRun(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "accounting", "owner"].includes(me.role)) return;

  const label = String(formData.get("label") ?? "").trim();
  const lotIds = formData.getAll("lot_ids").map(String).filter(Boolean);
  if (!label || lotIds.length === 0) return;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles").select("site_id").eq("id", me.id).single();
  let siteId = profile?.site_id as string | null;
  if (!siteId) {
    // Owner: anchor the run to the first selected lot's site.
    const { data: lot } = await supabase.from("stock_lots").select("site_id").eq("id", lotIds[0]).single();
    siteId = (lot?.site_id as string | null) ?? null;
  }
  if (!siteId) return;

  const { data: run, error } = await supabase
    .from("cost_price_runs")
    .insert({ site_id: siteId, label, created_by: me.id })
    .select("id")
    .single();
  if (error || !run) return;

  for (const lotId of lotIds) {
    await supabase.from("cost_price_run_lots").insert({ run_id: run.id, stock_lot_id: lotId });
  }
  revalidatePath("/manager/cost-price");
  revalidatePath("/accounting/cost-price");
}
