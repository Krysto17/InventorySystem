import { createClient } from "@/lib/supabase/server";

export type KnownAccount = { name: string; number: string; bank: string };

/**
 * Every bank account already used anywhere in the app, for the
 * account-name → number + bank autofill.
 *
 * Reads the `bank_accounts` directory (0139), which a trigger keeps filled from
 * every table that stores an account — supplier records, advances, expenses,
 * settlement payments and payout splits. This used to scrape three of those
 * tables on every render, which both cost three queries per page and quietly
 * missed the two it did not scrape.
 *
 * Most recently used first: the account someone is about to type is far more
 * often one they used this week than one from a year ago.
 */
export async function fetchKnownAccounts(): Promise<KnownAccount[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_accounts")
    .select("account_name, account_number, bank_name")
    .order("last_used_at", { ascending: false })
    .limit(500);

  return (data ?? []).map((r) => ({
    name: r.account_name as string,
    number: r.account_number as string,
    bank: r.bank_name as string,
  }));
}
