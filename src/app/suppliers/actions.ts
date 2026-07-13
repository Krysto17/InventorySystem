"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type SupplierEditState = { error?: string; ok?: string };

// A Nigerian bank account number is exactly 10 digits (all positive integers).
const ACCOUNT_NUMBER_RE = /^\d{10}$/;

// Roles that bring suppliers into the system (intake staff + supplier managers).
const SUPPLIER_CREATORS = ["owner", "manager", "processing", "receiving"];

// Register a supplier on its own — no visit required. Lands on the new
// supplier's page so account details can be added next.
export async function createSupplier(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || !SUPPLIER_CREATORS.includes(me.role)) return { error: "Not authorized" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Supplier name is required" };
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ name, phone, notes, created_by: me.id })
    .select("id")
    .single();
  if (error?.code === "23505") {
    return { error: `A supplier named "${name}" already exists — search for them instead.` };
  }
  if (error || !data) return { error: error?.message ?? "Failed to create supplier" };

  revalidatePath("/suppliers");
  redirect(`/suppliers/${data.id as string}`);
}

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

  const accountName = String(formData.get("account_name") ?? "").trim();
  const accountNumber = String(formData.get("account_number") ?? "").trim();
  const bankName = String(formData.get("bank_name") ?? "").trim();

  // Account number, when given, must be exactly 10 digits (all positive integers).
  if (accountNumber && !ACCOUNT_NUMBER_RE.test(accountNumber)) {
    return { error: "Account number must be exactly 10 digits (0-9)." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({
    account_name: accountName || null,
    account_number: accountNumber || null,
    bank_name: bankName || null,
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/suppliers/${id}`);
  return { ok: "Account details saved." };
}
