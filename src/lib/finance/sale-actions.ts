"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { ok, fail, type ActionResult } from "@/lib/actions/result";

// The revenue side of the profit-and-loss statement. Until 0170 nothing in the
// app recorded what material SOLD FOR — the cost-price workflow records only
// what a batch cost — so profit could not be computed at all. The manager
// records the sale; the owner approving it is what makes it revenue and takes
// the weight out of stock.

export async function recordBulkSale(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  const isOwner = me.role === "owner";
  if (!isOwner && me.role !== "manager") {
    return fail("Only the manager records a bulk sale.");
  }

  const buyer = String(formData.get("buyer_name") ?? "").trim();
  if (!buyer) return fail("Who bought it?");
  const materialTypeId = String(formData.get("material_type_id") ?? "");
  if (!materialTypeId) return fail("Pick the material.");

  const num = (k: string) => Number(String(formData.get(k) ?? "").replace(/,/g, "").trim());
  const weight = num("weight");
  const unitPrice = num("unit_price");
  if (!Number.isFinite(weight) || weight <= 0) return fail("Enter the weight sold, in kg.");
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return fail("Enter the price per kg.");

  const siteId = isOwner ? String(formData.get("site_id") ?? "") : (me.site_id ?? "");
  if (!siteId) return fail(isOwner ? "Choose a site." : "Your account has no site.");

  const soldAt = String(formData.get("sold_at") ?? "").trim();
  const received = String(formData.get("received_amount") ?? "").replace(/,/g, "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase.from("bulk_sales").insert({
    site_id: siteId,
    buyer_name: buyer,
    buyer_phone: String(formData.get("buyer_phone") ?? "").trim() || null,
    material_type_id: materialTypeId,
    grade: String(formData.get("grade") ?? "").trim() || null,
    weight,
    unit_price: unitPrice,
    // A sale may be entered the day after it happened; the statement reads
    // sold_at, so backdating has to be possible or a sale lands in the wrong
    // month.
    ...(soldAt ? { sold_at: new Date(soldAt).toISOString() } : {}),
    ...(received ? { received_amount: Number(received) } : {}),
    recorded_by: me.id,
  }).select("id");

  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if ((data ?? []).length === 0) return fail("That sale was not recorded — check your site.");

  revalidateSaleViews();
  return ok("Sale recorded. It becomes income once the owner approves it.");
}

/** The owner approving is what turns a sale into revenue and moves the stock. */
export async function approveBulkSale(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return decide(formData, "approved");
}

export async function rejectBulkSale(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return decide(formData, "rejected");
}

async function decide(formData: FormData, to: "approved" | "rejected"): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Only the owner approves a sale.");
  const id = String(formData.get("id") ?? "");
  if (!id) return fail("Missing sale.");

  const supabase = await createClient();
  const { data, error } = await supabase.from("bulk_sales")
    .update({
      approval_status: to,
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      ...(to === "rejected"
        ? { rejection_note: String(formData.get("rejection_note") ?? "").trim() || null }
        : {}),
    })
    // Only a pending sale can be decided, so a double submit cannot re-approve
    // an approved one and write a second stock movement out.
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("id");

  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if ((data ?? []).length === 0) {
    return fail("That sale was already decided, or is not yours to decide.");
  }

  revalidateSaleViews();
  return ok(to === "approved" ? "Sale approved — stock reduced and income recorded." : "Sale rejected.");
}

function revalidateSaleViews() {
  for (const p of ["/manager/bulk-sales", "/owner/profit-loss", "/accounting/profit-loss", "/inventory"]) {
    revalidatePath(p);
  }
}
