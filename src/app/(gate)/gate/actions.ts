"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

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
//
// That movement is exactly why the result cannot be dropped. The transition
// trigger refuses a pass that is no longer 'issued', and the 0153 balance guard
// refuses the release outright if the lot's bucket cannot cover it — while a
// pass on another site simply matches no rows. The gate reads "released" off
// this screen and hands the material over, so a refused release that looked
// like it worked would put material through the gate with no 'out' movement
// behind it.
export async function acknowledgeGatePass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "gate") return fail("Not authorized.");
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return fail("Missing gate pass.");
  const supabase = await createClient();
  const res = await supabase.from("gate_passes")
    .update({ status: "acknowledged" }).eq("id", id).select("id");
  const result = fromWrite(res, "This pass was not acknowledged — it may already have been released or cancelled.");
  if (!result.ok) return result;
  revalidatePath("/gate");
  return ok("Pass acknowledged — the material may leave.");
}
