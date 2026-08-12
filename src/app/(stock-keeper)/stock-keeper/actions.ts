"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

// The keeper ticks a lot as present, or disputes it. The RPC re-checks the
// role and takes the site from the lot, so this cannot file against another
// store's stock.
export async function confirmLot(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "stock_keeper" && me.role !== "owner")) return;
  const lotId = String(formData.get("stock_lot_id") ?? "");
  const counted = String(formData.get("counted_weight_kg") ?? "").trim();
  if (!lotId) return;

  const supabase = await createClient();
  await supabase.rpc("record_stock_check", {
    p_lot_id: lotId,
    p_status: "confirmed",
    p_counted_weight: counted === "" ? undefined : Number(counted),
    p_note: undefined,
  });
  revalidatePath("/stock-keeper");
}

export async function disputeLot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "stock_keeper" && me.role !== "owner")) return fail("Not authorized.");
  const lotId = String(formData.get("stock_lot_id") ?? "");
  const note = String(formData.get("dispute_note") ?? "").trim();
  const counted = String(formData.get("counted_weight_kg") ?? "").trim();
  if (!lotId) return fail("Missing lot.");
  if (!note) return fail("Say what is wrong — missing, short weight, wrong material.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_check", {
    p_lot_id: lotId,
    p_status: "disputed",
    p_counted_weight: counted === "" ? undefined : Number(counted),
    p_note: note,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/stock-keeper");
  return ok();
}

// Undo a check that was recorded by mistake, putting the lot back on the
// unchecked list.
export async function clearCheck(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "stock_keeper" && me.role !== "owner")) return;
  const lotId = String(formData.get("stock_lot_id") ?? "");
  if (!lotId) return;
  const supabase = await createClient();
  await supabase.from("stock_confirmations").delete().eq("stock_lot_id", lotId);
  revalidatePath("/stock-keeper");
}
