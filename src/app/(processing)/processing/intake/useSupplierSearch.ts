"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SupplierRow = { id: string; name: string; phone: string | null };

// Debounced live search over existing suppliers by name or phone. Used to
// suggest matches as the user types (so they pick an existing supplier instead
// of creating a duplicate). Empty until the query reaches `minLen` characters.
export function useSupplierSearch(query: string, minLen = 2, delayMs = 250) {
  const [results, setResults] = useState<SupplierRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // Strip characters that would break the PostgREST or() filter syntax.
    const term = query.trim().replace(/[,()*%]/g, "");
    if (term.length < minLen) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
        .order("name")
        .limit(8);
      setResults((data ?? []) as SupplierRow[]);
      setSearching(false);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [query, minLen, delayMs]);

  return { results, searching };
}
