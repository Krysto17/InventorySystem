"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type SupplierEditState = { error?: string; ok?: string };

// Manager or owner renames a supplier (old name kept in former_names).
export async function renameSupplier(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { error: "Not authorized" };
  const id = String(formData.get("supplier_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Name is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ name }).eq("id", id);
  if (error?.code === "23505") return { error: `Another supplier is already named "${name}".` };
  if (error) return { error: error.message };
  revalidatePath(`/suppliers/${id}`);
  revalidatePath("/suppliers");
  return { ok: "Supplier name updated." };
}

// Manager or owner updates the supplier's account details. The DB trigger keeps
// the previous set in former_accounts when it changes.
export async function saveSupplierAccount(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { error: "Not authorized" };
  const id = String(formData.get("supplier_id") ?? "");
  if (!id) return { error: "Missing supplier" };

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({
    account_name: String(formData.get("account_name") ?? "").trim() || null,
    account_number: String(formData.get("account_number") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/suppliers/${id}`);
  return { ok: "Account details saved." };
}
