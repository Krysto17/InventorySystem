import { createClient } from "@/lib/supabase/server";

export type KnownAccount = { name: string; number: string; bank: string };

// Directory of bank accounts already used anywhere in the app (suppliers,
// advances, expenses) — RLS-scoped to what the viewer may read. Powers the
// account-name → number + bank autofill across every account form.
export async function fetchKnownAccounts(): Promise<KnownAccount[]> {
  const supabase = await createClient();
  const [{ data: sup }, { data: adv }, { data: con }] = await Promise.all([
    supabase.from("suppliers").select("account_name, account_number, bank_name").not("account_number", "is", null).limit(1000),
    supabase.from("advances").select("account_name, account_number, bank_name").not("account_number", "is", null).limit(1000),
    supabase.from("consumables").select("account_name, account_number, bank_name").not("account_number", "is", null).limit(1000),
  ]);

  const seen = new Map<string, KnownAccount>();
  for (const r of [...(sup ?? []), ...(adv ?? []), ...(con ?? [])]) {
    const name = (r.account_name as string | null)?.trim();
    const number = (r.account_number as string | null)?.trim();
    const bank = (r.bank_name as string | null)?.trim();
    if (!name || !number || !bank) continue;
    // Key by number+name so the same person's account isn't duplicated.
    seen.set(`${number}|${name.toLowerCase()}`, { name, number, bank });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
