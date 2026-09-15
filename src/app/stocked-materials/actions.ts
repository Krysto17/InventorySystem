"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// A store without its own keeper is walked by the site manager.
const CAN_CHECK = ["stock_keeper", "manager", "owner"];

// The check itself goes through record_stock_check, which re-reads the site
// from the lot and refuses anything that is not in stock — so a keeper cannot
// file against another store, and only material still held can be counted.
//
// Every one of those refusals RAISES, and the error used to be dropped: the
// keeper ticked a lot, the row revalidated back exactly as it was, and nothing
// said whether the count had been filed or turned away ("that lot is not in
// stock", "this material has not been paid for yet", wrong store). disputeLot
// beside it already reported its refusals; this now matches it.
export async function confirmLot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !CAN_CHECK.includes(me.role)) return fail("Not authorized.");
  const lotId = String(formData.get("stock_lot_id") ?? "");
  const counted = String(formData.get("counted_weight_kg") ?? "").trim();
  if (!lotId) return fail("Missing lot.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_check", {
    p_lot_id: lotId,
    p_status: "confirmed",
    p_counted_weight: counted === "" ? undefined : Number(counted),
    p_note: undefined,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/stocked-materials");
  revalidatePath("/inventory");
  return ok();
}

export async function disputeLot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !CAN_CHECK.includes(me.role)) return fail("Not authorized.");
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
  revalidatePath("/stocked-materials");
  revalidatePath("/inventory");
  return ok();
}

// Undo a check recorded by mistake, putting the lot back on the uncounted list.
//
// The Undo button appears wherever the lot is readable, and `stock_lots` is
// readable cross-site by the general manager — but the DELETE is own-site only.
// So the GM could press Undo on another store's lot and get `error: null,
// data: []`: nothing deleted, nothing said, the check still standing. Asking for
// the deleted row back turns that into something the operator can see, and is
// safe here because everyone allowed to DELETE can also SELECT the row.
export async function clearCheck(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !CAN_CHECK.includes(me.role)) return fail("Not authorized.");
  const lotId = String(formData.get("stock_lot_id") ?? "");
  if (!lotId) return fail("Missing lot.");
  const supabase = await createClient();
  const res = await supabase.from("stock_confirmations")
    .delete().eq("stock_lot_id", lotId).select("stock_lot_id");
  const result = fromWrite(res, "That check was not undone — it may belong to another store.");
  if (!result.ok) return result;
  revalidatePath("/stocked-materials");
  revalidatePath("/inventory");
  return ok("Check undone.");
}
