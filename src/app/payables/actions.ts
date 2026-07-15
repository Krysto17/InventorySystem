"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, fromWrite, type ActionResult } from "@/lib/actions/result";

// Hold / release / send-back apply uniformly to the three payables. Each kind
// maps to its own SECURITY DEFINER RPC (authorization + site enforced in the DB).
type Kind = "settlement" | "advance" | "expense";
const HOLD: Record<Kind, "hold_settlement" | "hold_advance" | "hold_expense"> = {
  settlement: "hold_settlement", advance: "hold_advance", expense: "hold_expense",
};
const RELEASE: Record<Kind, "release_settlement" | "release_advance" | "release_expense"> = {
  settlement: "release_settlement", advance: "release_advance", expense: "release_expense",
};
const SEND_BACK: Record<Kind, "send_settlement_back" | "send_advance_back" | "send_expense_back"> = {
  settlement: "send_settlement_back", advance: "send_advance_back", expense: "send_expense_back",
};

const REVIEW_ROLES = ["owner", "manager", "accounting"];

function revalidateHubs() {
  revalidatePath("/owner/payments");
  revalidatePath("/manager/payments");
  revalidatePath("/accounting/payouts");
  revalidatePath("/owner/approvals");
}

function kindOf(formData: FormData): Kind | null {
  const k = String(formData.get("kind") ?? "");
  return k === "settlement" || k === "advance" || k === "expense" ? k : null;
}

export async function holdPayable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !REVIEW_ROLES.includes(me.role)) return fail("Not allowed to hold payments.");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!kind || !id) return fail("Missing payment.");
  const supabase = await createClient();
  const { error } = await supabase.rpc(HOLD[kind], { p_id: id });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidateHubs();
  return ok();
}

export async function releasePayable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !REVIEW_ROLES.includes(me.role)) return fail("Not allowed to release payments.");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!kind || !id) return fail("Missing payment.");
  const supabase = await createClient();
  const { error } = await supabase.rpc(RELEASE[kind], { p_id: id });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidateHubs();
  return ok();
}

// Mark an advance or expense paid (manager cash, or accountant/owner). The DB
// guard enforces the role + the approved → paid step; a held item must be
// released first. Settlements are paid through the payment ledger instead.
export async function markPayablePaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !REVIEW_ROLES.includes(me.role)) return fail("Not allowed to mark payments paid.");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!kind || kind === "settlement" || !id) return fail("Use the payment form for supplier settlements.");
  const table = kind === "advance" ? "advances" : "consumables";
  const supabase = await createClient();
  const res = await supabase.from(table).update({ approval_status: "paid" })
    .eq("id", id).eq("approval_status", "approved").select("id");
  const result = fromWrite(res, "Couldn't mark this paid — it may be on hold, already paid, or on another site.");
  if (result.ok) revalidateHubs();
  return result;
}

export async function sendPayableBack(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !REVIEW_ROLES.includes(me.role)) return fail("Not allowed to send payments back.");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!kind || !id) return fail("Missing payment.");
  if (!reason) return fail("Give the manager a reason for the correction.");
  const supabase = await createClient();
  const { error } = await supabase.rpc(SEND_BACK[kind], { p_id: id, p_reason: reason });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidateHubs();
  if (kind === "settlement") revalidatePath("/manager");
  return ok();
}
