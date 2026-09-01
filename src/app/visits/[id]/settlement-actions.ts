"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { parseAccountTrio } from "@/lib/validation/account";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// NB: settlement creation now lives in the approve_pricing RPC (migration 0090) —
// the owner's price approval snapshots the settlement from settlement_totals and
// sends it straight to accounting. The old manual submitBatchSettlement action
// was retired with the "Submit batch to accounting" button.

// Manager (or owner) leaves a note on a supply/batch — visible to the owner
// (approving) and the accountant (before paying).
export async function addBatchComment(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!visitId || !body) return;

  const supabase = await createClient();
  const { data: visit } = await supabase.from("visits").select("site_id").eq("id", visitId).single();
  if (!visit) return;
  await supabase.from("batch_comments").insert({
    visit_id: visitId, site_id: visit.site_id as string, body, author: me.id,
  });
  revalidatePath(`/visits/${visitId}`);
}

// Manager records the supplier's bank/account details before submitting the
// batch settlement. Saved on the global supplier record.
export async function updateSupplierAccount(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return fail("Not allowed to change account details.");
  const supplierId = String(formData.get("supplier_id") ?? "");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!supplierId) return fail("Missing supplier.");

  // Account name, number, and bank must be a complete set (or all blank).
  const acct = parseAccountTrio(
    String(formData.get("account_name") ?? ""),
    String(formData.get("account_number") ?? ""),
    String(formData.get("bank_name") ?? ""),
  );
  // invalid partial set — the DB enforces this too, but say so rather than
  // dropping the edit on the floor.
  if (!acct.ok) return fail("Give the account name, number and bank together, or leave all three blank.");

  const supabase = await createClient();
  const res = await supabase.from("suppliers").update(acct.value).eq("id", supplierId).select("id");
  const result = fromWrite(res, "The account details were not saved — you may not have permission for this supplier.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Account details saved.");
}

// Owner approves/rejects; accountant marks paid. The DB trigger enforces which
// role may take each transition.
// NB: nothing under src/ calls this today — the approve/reject/pay transitions
// run through their own RPCs. It is converted rather than deleted because it is
// part of the silent-write surface and would report a refused status change as
// success if anything did call it. Whether it should exist at all is dead-code
// cleanup for a later phase.
export async function setSettlementStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  const visitId = String(formData.get("visit_id") ?? "");
  const id = String(formData.get("settlement_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return fail("Missing settlement.");
  if (!["approved", "rejected", "paid"].includes(status)) return fail("Unknown settlement status.");

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "rejected") {
    patch.rejection_note = String(formData.get("rejection_note") ?? "").trim() || "Rejected by owner";
  }
  const res = await supabase.from("batch_settlements").update(patch as never).eq("id", id).select("id");
  const result = fromWrite(res, "The status was not changed — this transition may not be yours to make.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
  revalidatePath("/accounting/payouts");
  return ok("Settlement updated.");
}
