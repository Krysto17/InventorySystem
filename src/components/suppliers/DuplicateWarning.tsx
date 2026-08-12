"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type SimilarSupplier = {
  id: string; name: string; supplier_code: string | null;
  account_name: string | null; account_number: string | null; bank_name: string | null;
  similarity: number; same_account: boolean;
};

// Live "did you mean…" check while a supplier is being typed. Duplicates like
// "Madam Maria" vs "Maria Dung" are invisible to an exact-match check, so this
// looks for similar NAMES and — the strongest signal — a bank account already
// on file. Advisory only: it never blocks saving.
export function DuplicateWarning({
  name, accountNumber, excludeId,
}: {
  name: string; accountNumber?: string; excludeId?: string;
}) {
  // Matches are stamped with the query they answer, so a query too short to
  // search simply has no answer — no need to clear state from the effect.
  const [found, setFound] = useState<{ key: string; rows: SimilarSupplier[] }>({ key: "", rows: [] });

  const n = name.trim();
  const acct = (accountNumber ?? "").trim();
  const worthSearching = n.length >= 3 || acct.length >= 10;
  const key = `${n}|${acct}|${excludeId ?? ""}`;

  useEffect(() => {
    if (!worthSearching) return;

    let cancelled = false;
    // Debounce so we aren't querying on every keystroke.
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("find_similar_suppliers", {
        p_name: n || undefined,
        p_account_number: acct || undefined,
        p_exclude: excludeId || undefined,
      });
      if (!cancelled) setFound({ key, rows: (data ?? []) as SimilarSupplier[] });
    }, 350);

    return () => { cancelled = true; clearTimeout(t); };
  }, [key, n, acct, excludeId, worthSearching]);

  const matches = worthSearching && found.key === key ? found.rows : [];
  if (matches.length === 0) return null;
  const accountClash = matches.some((m) => m.same_account);

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-900/20">
      <p className="font-semibold text-amber-900 dark:text-amber-300">
        {accountClash
          ? "⚠ That bank account is already on file — this is very likely the same person."
          : "⚠ Similar supplier already exists — is this the same person?"}
      </p>
      <ul className="mt-1 space-y-0.5">
        {matches.map((m) => (
          <li key={m.id}>
            <Link href={`/suppliers/${m.id}`} className="underline">{m.name}</Link>
            <span className="text-amber-800 dark:text-amber-400">
              {m.supplier_code ? ` · ${m.supplier_code}` : ""}
              {m.account_number ? ` · ${m.account_number}` : ""}
              {m.same_account ? " · SAME ACCOUNT" : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-amber-800 dark:text-amber-400">
        Use the existing supplier instead of creating a second record — duplicates split their
        history and balances.
      </p>
    </div>
  );
}
