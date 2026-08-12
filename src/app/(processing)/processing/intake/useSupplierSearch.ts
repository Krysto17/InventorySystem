"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SupplierRow = { id: string; name: string; phone: string | null };

// Debounced live search over existing suppliers by name or phone. Used to
// suggest matches as the user types (so they pick an existing supplier instead
// of creating a duplicate). Empty until the query reaches `minLen` characters.
export function useSupplierSearch(query: string, minLen = 2, delayMs = 250) {
  // Results are stamped with the term they answer, so "still searching" is
  // simply "the answer we hold is for an older term" — derived, never stored.
  const [hits, setHits] = useState<{ term: string; rows: SupplierRow[] }>({ term: "", rows: [] });

  // Strip characters that would break the PostgREST or() filter syntax.
  const term = query.trim().replace(/[,()*%]/g, "");
  const active = term.length >= minLen;

  useEffect(() => {
    if (!active) return;
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
        .order("name")
        .limit(8);
      setHits({ term, rows: (data ?? []) as SupplierRow[] });
    }, delayMs);
    return () => clearTimeout(handle);
  }, [term, active, delayMs]);

  if (!active) return { results: [] as SupplierRow[], searching: false };
  return { results: hits.term === term ? hits.rows : [], searching: hits.term !== term };
}
