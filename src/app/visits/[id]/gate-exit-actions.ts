"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// A manager (own site) or the owner authorises a no-agreement visit to leave.
//
// An INSERT that RLS refuses RAISES rather than matching zero rows, so `error`
// is the whole signal and there is deliberately no .select() here. The one
// everyday refusal is UNIQUE (visit_id): a second click, or a colleague who got
// there first. That means the exit IS authorised — the state asked for already
// exists — so it is reported as such rather than as a failure, the same way a
// repeated release is. The audit event is written by an AFTER INSERT trigger,
// so a refused insert leaves no stray event behind.
export async function authorizeGateExit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return fail("Not authorized.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing visit.");

  const supabase = await createClient();
  const { error } = await supabase.from("gate_exit_authorizations").insert({
    visit_id: visitId,
    authorized_by: me.id,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (error) {
    if (error.code !== "23505") {
      if (error.code === "42501") return fail("You can only authorise an exit for a visit on your own site.");
      if (error.code === "23503") return fail("That visit no longer exists.");
      return fail(error.message.replace(/^.*?:\s*/, ""));
    }
  }
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/gate");
  return ok(error ? "This exit was already authorised." : "Exit authorised — the gate can release the supplier.");
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
  // 0159: the release is the only direct stage change, and only the gate at its
  // own site or the owner may make it.
  if (res.error?.code === "VT001") return fail("You cannot move this visit to that stage.");
  const result = fromWrite(res, "The supplier was not released — the exit may not be authorised, or the visit may be on another site.");
  if (!result.ok) return result;
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/gate");
  return ok("Supplier released.");
}
