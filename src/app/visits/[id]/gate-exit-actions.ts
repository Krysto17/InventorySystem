"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

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
export async function releaseSupplier(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "gate" && me.role !== "owner")) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits").select("state").eq("id", visitId).single();
  if (!visit || visit.state !== "awaiting_gate_exit") return;

  await supabase.from("visits").update({ state: "exited" }).eq("id", visitId);
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/gate");
}
