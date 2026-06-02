"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type PaymentState = { error?: string };

const DIRECTIONS = ["processing_fee_in", "purchase_amount_out"] as const;
const METHODS = ["cash", "transfer", "deduction", "other"] as const;

export async function recordPayment(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "accounting" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const direction = String(formData.get("direction") ?? "");
  if (!DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) {
    return { error: "Invalid direction" };
  }

  const amount = Number(formData.get("amount"));
  if (!(amount > 0)) return { error: "Amount must be greater than 0" };

  const method = String(formData.get("method") ?? "").trim() || null;
  if (method && !METHODS.includes(method as (typeof METHODS)[number])) {
    return { error: "Invalid payment method" };
  }
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Guard: purchase_amount_out cannot be recorded on exited/not-agreed visits
  const supabase = await createClient();
  if (direction === "purchase_amount_out") {
    const { data: visit } = await supabase
      .from("visits")
      .select("state")
      .eq("id", visitId)
      .single();
    if (!visit) return { error: "Visit not found" };
    if (visit.state === "exited") {
      return { error: "Cannot record purchase payment on an exited (no-agreement) visit" };
    }
  }

  const { error } = await supabase.from("payments").insert({
    visit_id: visitId,
    direction,
    amount,
    method,
    notes,
    recorded_by: me.id,
    paid_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting");
  return {};
}

export async function toggleProcessingDeducted(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "accounting" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  const deducted = formData.get("processing_deducted") === "true";
  if (!visitId) return { error: "Missing visit id" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("visits")
    .update({ processing_deducted: deducted })
    .eq("id", visitId);
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  return {};
}

export async function settleVisit(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "accounting" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("visits")
    .update({ state: "awaiting_stock_intake" })
    .eq("id", visitId);
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting");
  return {};
}
