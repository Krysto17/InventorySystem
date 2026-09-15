"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// A manager (own site) or the owner authorises a no-agreement visit to leave.
export async function authorizeGateExit(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;

  const supabase = await createClient();
  await supabase.from("gate_exit_authorizations").insert({
    visit_id: visitId,
    authorized_by: me.id,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/gate");
}

// The gate releases the supplier once an authorisation exists (→ exited). The DB
// state-machine trigger blocks the release if no authorisation row is present.
//
// This button is what lets a supplier physically leave the yard, so a refusal
// the gate never sees is the worst kind of silence here. Two real ways it is
// refused: the trigger RAISES `cannot release without a gate exit
// authorization` when the authorisation was withdrawn between render and click,
// and a gate on another site matches no rows at all. Both were dropped.
//
// The `awaiting_gate_exit` pre-check below is left exactly as it was: a second
// click after a successful release is an ordinary no-op, not a failure, and the
// state machine is not being redesigned to make it one.
export async function releaseSupplier(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "gate" && me.role !== "owner")) return fail("Not authorized.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing visit.");

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits").select("state").eq("id", visitId).single();
  if (!visit) return fail("That visit could not be loaded.");
  if (visit.state !== "awaiting_gate_exit") return ok("This supplier has already been released.");

  const res = await supabase.from("visits")
    .update({ state: "exited" }).eq("id", visitId).select("id");
  const result = fromWrite(res, "The supplier was not released — the exit may not be authorised, or the visit may be on another site.");
  if (!result.ok) return result;
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/gate");
  return ok("Supplier released.");
}
