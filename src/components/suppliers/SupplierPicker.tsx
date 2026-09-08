"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PickerSupplier = { id: string; name: string; code: string | null };

// A searchable supplier chooser. A plain <select> of hundreds of suppliers is
// unusable on a phone — this filters by name or supplier code as you type and
// submits the chosen id in a hidden field.
//
// It searches the DATABASE as well as the list it was handed. The pages that
// render it fetch a capped roster (the advances screen took 300), and once the
// business passed that many suppliers the tail of the alphabet simply stopped
// being selectable — WOKRIT EMMANUEL had 21 advances already and could not be
// picked for a new one. The seed list still answers instantly for the common
// case; the query is what stops the picker going stale as suppliers are added.
export function SupplierPicker({
  name = "supplier_id",
  suppliers,
  required = true,
  label = "Supplier",
}: {
  name?: string;
  suppliers: PickerSupplier[];
  required?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<PickerSupplier | null>(null);
  const [open, setOpen] = useState(false);
  // Results are stamped with the term they answer, so "still searching" is
  // simply "the answer we hold is for an older term" — derived, never stored.
  const [remote, setRemote] = useState<{ term: string; rows: PickerSupplier[] }>({ term: "", rows: [] });

  // Match on WORDS, not the whole string. Typing a name exactly as it looks
  // still missed people: "Lucky  Elisha" and "Young  Timkat" carry a double
  // space, and "Mus’ab", "Sa’adu" and "Usman Mu’sab" use a typographic
  // apostrophe, so `%Lucky Elisha%` and `%Mus'ab%` matched nothing at all.
  // Splitting on anything that is not a letter or digit sidesteps both, and
  // lets the words be typed in any order.
  const term = q.trim();
  // Memoised: a fresh array every render would re-trigger the debounce below on
  // every render instead of only when the typing changes.
  const tokens = useMemo(
    () => term.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 5),
    [term],
  );
  const searchable = term.length >= 2 && tokens.length > 0 && !picked;

  useEffect(() => {
    if (!searchable) return;
    const handle = setTimeout(async () => {
      // One .or() per token; successive filters are AND-ed, so every word must
      // appear somewhere in the name or the code.
      let query = createClient()
        .from("suppliers")
        .select("id, name, supplier_code");
      for (const tok of tokens) {
        query = query.or(`name.ilike.%${tok}%,supplier_code.ilike.%${tok}%`);
      }
      const { data } = await query.order("name").limit(8);
      setRemote({
        term,
        rows: (data ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
          code: (s.supplier_code as string | null) ?? null,
        })),
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [term, tokens, searchable]);

  const matches = useMemo(() => {
    if (tokens.length === 0) return suppliers.slice(0, 8);
    // Same rule as the query above, so the seed list and the database agree.
    const local = suppliers.filter((s) => {
      const hay = `${s.name} ${s.code ?? ""}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok.toLowerCase()));
    });
    // Local first (it is already on screen), then anything only the database
    // knows about. Same id from both sides is one entry.
    const seen = new Set(local.map((s) => s.id));
    const extra = (remote.term === term ? remote.rows : []).filter((s) => !seen.has(s.id));
    return [...local, ...extra].slice(0, 8);
  }, [suppliers, term, tokens, remote]);

  const searching = searchable && remote.term !== term;

  return (
    <div className="text-sm">
      <label className="block">
        {label}
        <input type="hidden" name={name} value={picked?.id ?? ""} required={required} />
        <input
          type="text"
          value={picked ? `${picked.name}${picked.code ? ` (${picked.code})` : ""}` : q}
          onChange={(e) => { setPicked(null); setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search supplier by name or code…"
          autoComplete="off"
          className="mt-1 block w-full rounded border px-2 py-1 text-sm"
        />
      </label>

      {open && !picked && (matches.length > 0 || searching) && (
        <ul className="relative z-20 mt-1 max-h-48 overflow-auto rounded border border-line bg-paper shadow-lg">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                // Fires before blur so the pick registers.
                onMouseDown={(e) => { e.preventDefault(); setPicked(s); setQ(""); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="font-medium">{s.name}</span>
                {s.code && <span className="ml-2 text-xs text-ink-2">{s.code}</span>}
              </button>
            </li>
          ))}
          {searching && (
            <li className="px-3 py-2 text-xs text-ink-2">Searching…</li>
          )}
        </ul>
      )}
      {open && !picked && !searching && term.length >= 2 && matches.length === 0 && (
        <p className="mt-1 text-xs text-ink-2">No supplier matches “{term}”.</p>
      )}
      {picked && (
        <button type="button" onClick={() => { setPicked(null); setQ(""); }}
          className="mt-1 text-xs text-ink-2 hover:underline">Change supplier</button>
      )}
    </div>
  );
}
