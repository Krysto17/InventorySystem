"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { parseAccountTrio } from "@/lib/validation/account";

export type SupplierEditState = { error?: string; ok?: string };

// A Nigerian bank account number is exactly 10 digits (all positive integers).

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

// Owner records a supplier's pre-software opening debt as a one-off paid advance
// dated to the opening date. The record_opening_balance RPC enforces owner-only
// and one-per-supplier.
export async function recordOpeningBalance(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Only the owner can record an opening balance." };
  const id = String(formData.get("supplier_id") ?? "");
  const amount = Number(formData.get("amount"));
  const asOf = String(formData.get("as_of") ?? "").trim() || null;
  if (!id) return { error: "Missing supplier" };
  if (!(amount > 0)) return { error: "Amount must be greater than zero." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_opening_balance", {
    p_supplier_id: id,
    p_amount: amount,
    ...(asOf ? { p_as_of: asOf } : {}),
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  revalidatePath(`/suppliers/${id}`);
  return { ok: "Opening balance recorded." };
}

// Record a debt repayment the supplier made OUTSIDE the app (e.g. bank transfer).
// It reduces outstanding debt immediately; the DB blocks repaying more than owed.
// Owner / manager / accounting. (RPC re-checks the role + resolves the site.)
export async function recordDebtRepayment(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || !["owner", "manager", "accounting"].includes(me.role)) {
    return { error: "Not authorized to record a repayment." };
  }
  const id = String(formData.get("supplier_id") ?? "");
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id) return { error: "Missing supplier" };
  if (!(amount > 0)) return { error: "Amount must be greater than zero." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_debt_repayment", {
    p_supplier_id: id,
    p_amount: amount,
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  revalidatePath(`/suppliers/${id}`);
  return { ok: "Repayment recorded — outstanding debt reduced." };
}

// Manager or owner deletes a supplier that has no records (no visits, advances,
// stock lots, gate passes, …). The delete_supplier RPC re-checks the role and
// refuses when anything references the supplier.
export async function deleteSupplier(_prev: SupplierEditState, formData: FormData): Promise<SupplierEditState> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { error: "Not authorized" };
  const id = String(formData.get("supplier_id") ?? "");
  if (!id) return { error: "Missing supplier" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_supplier", { p_supplier_id: id });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  revalidatePath("/suppliers");
  redirect("/suppliers");
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

  // Account name, number, and bank must be entered together (or all blank).
  const acct = parseAccountTrio(
    String(formData.get("account_name") ?? ""),
    String(formData.get("account_number") ?? ""),
    String(formData.get("bank_name") ?? ""),
  );
  if (!acct.ok) return { error: acct.error };

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update(acct.value).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/suppliers/${id}`);
  return { ok: "Account details saved." };
}

// Switch the supplier's active account to one from its history. The current
// account is archived; the chosen one becomes current (and leaves history).
export async function switchSupplierAccount(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const id = String(formData.get("supplier_id") ?? "");
  const number = String(formData.get("account_number") ?? "").trim();
  if (!id || !number) return;

  const supabase = await createClient();
  const { data: s } = await supabase.from("suppliers").select("former_accounts, account_number").eq("id", id).maybeSingle();
  if (!s || s.account_number === number) return; // already current
  const formers = (s.former_accounts as { account_name?: string | null; account_number?: string | null; bank_name?: string | null }[] | null) ?? [];
  const target = formers.find((a) => a.account_number === number);
  if (!target?.account_number) return;

  await supabase.from("suppliers").update({
    account_name: target.account_name ?? null,
    account_number: target.account_number,
    bank_name: target.bank_name ?? null,
  }).eq("id", id);
  revalidatePath(`/suppliers/${id}`);
}
