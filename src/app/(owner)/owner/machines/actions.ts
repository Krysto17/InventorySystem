"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

const BASES = ["weight", "bag", "hour"] as const;

export async function createMachine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const site_id = String(formData.get("site_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const charge_basis = String(formData.get("charge_basis") ?? "");
  const rate = Number(formData.get("rate"));
  if (!site_id || !name) return;
  if (!BASES.includes(charge_basis as (typeof BASES)[number])) return;
  if (!(rate >= 0)) return;
  const supabase = await createClient();
  await supabase.from("machines").insert({ site_id, name, charge_basis, rate, created_by: me.id });
  revalidatePath("/owner/machines");
}

export async function updateMachine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const id = String(formData.get("id") ?? "");
  const patch: Record<string, unknown> = {};
  const rate = formData.get("rate");
  if (rate != null && String(rate).trim() !== "") patch.rate = Number(rate);
  const activeRaw = formData.get("active");
  if (activeRaw != null) patch.active = activeRaw === "true";
  const supabase = await createClient();
  await supabase.from("machines").update(patch as never).eq("id", id);
  revalidatePath("/owner/machines");
}
