"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

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
export async function updateSupplierAccount(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const supplierId = String(formData.get("supplier_id") ?? "");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!supplierId) return;

  const supabase = await createClient();
  await supabase.from("suppliers").update({
    account_name: String(formData.get("account_name") ?? "").trim() || null,
    account_number: String(formData.get("account_number") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
  }).eq("id", supplierId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// Owner approves/rejects; accountant marks paid. The DB trigger enforces which
// role may take each transition.
export async function setSettlementStatus(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  const visitId = String(formData.get("visit_id") ?? "");
  const id = String(formData.get("settlement_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["approved", "rejected", "paid"].includes(status)) return;

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "rejected") {
    patch.rejection_note = String(formData.get("rejection_note") ?? "").trim() || "Rejected by owner";
  }
  await supabase.from("batch_settlements").update(patch as never).eq("id", id);
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner/approvals");
  revalidatePath("/accounting/payouts");
}
