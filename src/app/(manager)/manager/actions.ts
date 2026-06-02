"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type PricingState = { error?: string };

const TERMS = ["immediate", "deferred", "installment", "deducted"] as const;
const STATUSES = ["pending", "agreed", "not_agreed"] as const;

export async function submitPricing(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "manager" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  const recordId = String(formData.get("record_id") ?? "");
  if (!visitId && !recordId) return { error: "Missing visit/record id" };

  const status = String(formData.get("agreement_status") ?? "pending");
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { error: "Invalid agreement status" };
  }
  const unitPriceRaw = String(formData.get("unit_price") ?? "").trim();
  const unitPrice = unitPriceRaw ? Number(unitPriceRaw) : null;
  const terms = String(formData.get("payment_terms") ?? "").trim() || null;
  if (terms && !TERMS.includes(terms as (typeof TERMS)[number])) {
    return { error: "Invalid payment terms" };
  }

  if (status === "agreed") {
    if (unitPrice == null || !(unitPrice >= 0)) {
      return { error: "Unit price is required for an agreed deal" };
    }
    if (!terms) return { error: "Payment terms are required for an agreed deal" };
  }

  const supabase = await createClient();

  if (recordId) {
    const patch: Record<string, unknown> = {
      agreement_status: status,
      unit_price: unitPrice,
      payment_terms: terms,
    };
    if (me.role === "owner") patch.overridden_by = me.id;
    const { error } = await supabase.from("pricing").update(patch).eq("id", recordId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("pricing").insert({
      visit_id: visitId,
      unit_price: unitPrice,
      agreement_status: status,
      payment_terms: terms,
      priced_by: me.id,
    });
    if (error) return { error: error.message };
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  return {};
}
