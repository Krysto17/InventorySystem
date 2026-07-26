"use client";

import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSupplier } from "@/app/suppliers/actions";
import type { SupplierEditState } from "@/app/suppliers/actions";
import type { SimilarSupplier } from "@/components/suppliers/DuplicateWarning";

const init: SupplierEditState = {};

// Fold a duplicate supplier into this one: every visit, advance, lot, gate pass
// and analysis moves across, the old name is kept as history, and the duplicate
// record is removed. Owner / general manager only.
export function MergeSupplierTool({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const [state, action, pending] = useActionState(mergeSupplier, init);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<SimilarSupplier[]>([]);
  const [picked, setPicked] = useState<SimilarSupplier | null>(null);

  // Suggest likely duplicates of THIS supplier up front, then search as you type.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("find_similar_suppliers", {
        p_name: q.trim() || supplierName,
        p_exclude: supplierId,
      });
      if (!cancelled) setOptions((data ?? []) as SimilarSupplier[]);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, supplierName, supplierId]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Same person entered twice? Merge the duplicate into <strong>{supplierName}</strong> — all its
        records move here, its name is kept in the history, and the duplicate is removed. This
        can&rsquo;t be undone.
      </p>

      <input
        type="text" value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }}
        placeholder="Search the duplicate by name…"
        className="block w-full max-w-sm rounded border px-2 py-1 text-sm" autoComplete="off"
      />

      {options.length > 0 && !picked && (
        <ul className="max-h-44 divide-y divide-line overflow-auto rounded border border-line">
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setPicked(o)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <span className="font-medium">{o.name}</span>
                <span className="block text-xs text-ink-2">
                  {o.supplier_code ?? "—"}{o.account_number ? ` · ${o.account_number}` : ""}
                  {o.same_account ? " · SAME ACCOUNT" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <form action={action} className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-900/20">
          <input type="hidden" name="keep_id" value={supplierId} />
          <input type="hidden" name="duplicate_id" value={picked.id} />
          <p className="text-xs text-amber-900 dark:text-amber-300">
            Merge <strong>{picked.name}</strong> into <strong>{supplierName}</strong>? Everything
            recorded against {picked.name} will belong to {supplierName}.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {pending ? "Merging…" : "Merge them"}
            </button>
            <button type="button" onClick={() => setPicked(null)}
              className="rounded border border-line px-3 py-1.5 text-sm hover:bg-white">Cancel</button>
          </div>
        </form>
      )}

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">{state.ok}</p>}
    </div>
  );
}
