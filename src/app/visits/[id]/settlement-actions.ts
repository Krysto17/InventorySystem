"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

const sum = (rows: { amount?: unknown; purchase_amount?: unknown }[] | null, key: "amount" | "purchase_amount") =>
  (rows ?? []).reduce((s, r) => s + Number((r as Record<string, unknown>)[key] ?? 0), 0);

// Manager assembles + submits the batch payout: net = materials − light bill −
// advance deducted. Snapshots the figures; one settlement per visit (a pending
// or rejected one is rebuilt on resubmit; approved/paid is locked).
export async function submitBatchSettlement(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits").select("site_id, supplier_id, state").eq("id", visitId).single();
  if (!visit) return;
  // A settlement can only be assembled once the owner has approved the pricing
  // (visit is in_accounting). That price approval IS the director's payment
  // approval — so the settlement goes straight to accounting.
  if (visit.state !== "in_accounting") return;

  const [{ data: lines }, { data: charges }, { data: deds }, { data: debt }, { data: existing }] =
    await Promise.all([
      supabase.from("visit_materials").select("purchase_amount").eq("visit_id", visitId),
      supabase.from("utility_charges").select("kind, amount").eq("visit_id", visitId),
      supabase.from("advance_deductions").select("amount").eq("ref_visit_id", visitId),
      supabase.rpc("supplier_outstanding_debt", { _supplier_id: visit.supplier_id }),
      supabase.from("batch_settlements").select("id, status").eq("visit_id", visitId).maybeSingle(),
    ]);

  if (existing && (existing.status === "approved" || existing.status === "paid")) return; // locked
  if (existing) await supabase.from("batch_settlements").delete().eq("id", existing.id);

  const materials = sum(lines, "purchase_amount");
  // Processing fee (light bill) only — "other" charges are separate deductions,
  // not part of the processing fee. Both still reduce the net payout.
  const chargeRows = (charges ?? []) as { kind?: string; amount?: unknown }[];
  const light = chargeRows.filter((c) => c.kind === "light_bill").reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const other = chargeRows.filter((c) => c.kind === "other").reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const advance = sum(deds, "amount");

  // The owner already approved the price (visit is in_accounting), which counts
  // as the payment approval — so the settlement is created as APPROVED and goes
  // straight to the accountant's to-pay queue.
  await supabase.from("batch_settlements").insert({
    visit_id: visitId,
    site_id: visit.site_id,
    materials_total: materials,
    light_bill_total: light,
    advance_deducted: advance,
    net_balance: materials - light - other - advance,
    remaining_debt: Number(debt ?? 0),
    submitted_by: me.id,
    status: "approved",
    approved_by: me.id,
    approved_at: new Date().toISOString(),
  });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting/payouts");
}

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
