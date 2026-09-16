"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

// Manager (or owner) issues a gate pass authorising outgoing material; the gate
// acknowledges it before release. A pass can be tied to an available stock lot
// (traceable back to receiving) — on acknowledgement that lot leaves stock.
//
// Authorization is deliberately unchanged (3E-6K, Option D): the database lets
// only the owner or the general manager create an issued pass, and receiving a
// pending request on its own site. What changed is that nothing is silent any
// more. Every refusal below used to be a bare `return` or a swallowed insert
// error — the form cleared and no pass appeared. The two that operators really
// hit: the owner, whose account has no site, and the GM picking a lot from
// another site. Neither rule is relaxed; both now say why.
//
// An INSERT that RLS refuses RAISES, so `error` is the whole signal and there is
// no .select() of the new row (the .select() calls above it are lookups).
export async function issueGatePass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner", "receiving"].includes(me.role)) {
    return fail("Only a manager, the owner or receiving can raise a gate pass.");
  }
  // Receiving raises a request; it carries no authority until a manager signs
  // it off. Manager/owner passes are authorised on the spot.
  const isRequest = me.role === "receiving";

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  // Not inferred from the lot or anywhere else: a pass belongs to the issuer's
  // site, and the owner has none.
  if (!siteId) return fail("Your account has no site to issue this gate pass from.");

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return fail("Enter the reason the material is leaving.");
  const stockLotId = String(formData.get("stock_lot_id") ?? "") || null;
  let supplierId = String(formData.get("supplier_id") ?? "") || null;
  let materialTypeId = String(formData.get("material_type_id") ?? "") || null;
  const bagsRaw = String(formData.get("bags") ?? "").trim();
  const weightRaw = String(formData.get("weight_kg") ?? "").trim();
  let weightKg = weightRaw === "" ? null : Number(weightRaw);

  // When a lot is chosen, default the material / supplier / weight from it so
  // the released quantity matches what is actually in stock.
  if (stockLotId) {
    const { data: lot } = await supabase
      .from("stock_lots")
      .select("material_type_id, supplier_id, weight_kg, site_id, status")
      .eq("id", stockLotId)
      .single();
    if (!lot) return fail("That stock lot could not be found.");
    if (lot.site_id !== siteId) {
      return fail("That stock lot is on another site — a gate pass can only release material from your own site.");
    }
    if (lot.status !== "available") return fail("That stock lot is no longer available.");
    materialTypeId = materialTypeId ?? (lot.material_type_id as string);
    supplierId = supplierId ?? (lot.supplier_id as string | null);
    weightKg = weightKg ?? Number(lot.weight_kg);
  }

  const { error } = await supabase.from("gate_passes").insert({
    site_id: siteId,
    supplier_id: supplierId,
    material_owner: String(formData.get("material_owner") ?? "").trim() || null,
    material_type_id: materialTypeId,
    stock_lot_id: stockLotId,
    bags: bagsRaw === "" ? null : Number(bagsRaw),
    weight_kg: weightKg,
    reason,
    issued_by: me.id,
    ...(isRequest
      ? { status: "pending", requested_by: me.id }
      : { status: "issued", authorized_by: me.id, authorized_at: new Date().toISOString() }),
  });
  if (error) {
    if (error.code === "42501") {
      return fail(isRequest
        ? "Receiving can only raise a gate pass request for its own site."
        : "Only the general manager or the owner can issue a gate pass.");
    }
    if (error.code === "23503") return fail("Something on this pass no longer exists — reload the page and try again.");
    if (error.code === "23514") return fail("Bags and weight must be zero or more.");
    // 0155: one live pass per lot. The key named in the details identifies that
    // index without showing its name to anyone.
    if (error.code === "23505" && (error.details ?? "").includes("(stock_lot_id)")) {
      return fail("That stock lot already has a live gate pass.");
    }
    // 0155's lot guard re-checks the lot under a lock at the moment of issue,
    // so it catches what the checks above could only see a moment earlier.
    if (error.code === "GP001") return fail("That stock lot is no longer available.");
    if (error.code === "GP002") {
      return fail("That stock lot is on another site — a gate pass can only release material from your own site.");
    }
    if (error.code === "GP003") return fail("That stock lot is a different material from the one selected.");
    // Anything unanticipated gets a fixed message: raw database text can name
    // tables, constraints or policies, and none of that is the operator's.
    return fail("The gate pass could not be saved. Please try again.");
  }
  revalidatePath("/manager/gate-passes");
  revalidatePath("/receiving");
  return ok(isRequest ? "Gate pass request raised — a manager must authorise it." : "Gate pass issued.");
}

export async function cancelGatePass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (me.role !== "manager" && me.role !== "owner") return fail("Only a manager or the owner can drop a gate pass.");
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return fail("Missing gate pass.");
  const supabase = await createClient();
  // The transition trigger decides which drops are legal (pending → cancelled
  // and issued → cancelled) and raises otherwise; a refused update would
  // otherwise come back as no error and no rows.
  const res = await supabase.from("gate_passes")
    .update({ status: "cancelled" }).eq("id", id).select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  if (!res.data || res.data.length === 0) {
    return fail("That gate pass was not cancelled — it may already be acknowledged.");
  }
  revalidatePath("/manager/gate-passes");
  revalidatePath("/receiving");
  return ok("Gate pass cancelled.");
}

// Manager (or owner) authorises a gate pass raised by receiving — only then is
// it valid at the gate. The RPC re-checks the role, site and pending status.
export async function authorizeGatePass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  if (!["manager", "owner"].includes(me.role)) return fail("Only a manager or the owner can authorise a gate pass.");
  const id = String(formData.get("pass_id") ?? "");
  if (!id) return fail("Missing gate pass.");
  const supabase = await createClient();
  // The RPC re-checks role, site and pending status, and raises with a message
  // worth showing — "only a pending gate pass can be authorized (status: …)".
  const { error } = await supabase.rpc("authorize_gate_pass", { p_pass_id: id });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/manager/gate-passes");
  revalidatePath("/receiving");
  return ok("Gate pass authorised — the gate can release it now.");
}
