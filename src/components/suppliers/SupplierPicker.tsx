"use client";

import { useMemo, useState } from "react";

export type PickerSupplier = { id: string; name: string; code: string | null };

// A searchable supplier chooser. A plain <select> of hundreds of suppliers is
// unusable on a phone — this filters by name or supplier code as you type and
// submits the chosen id in a hidden field.
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

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return suppliers.slice(0, 8);
    return suppliers
      .filter((s) => s.name.toLowerCase().includes(t) || (s.code ?? "").toLowerCase().includes(t))
      .slice(0, 8);
  }, [suppliers, q]);

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

      {open && matches.length > 0 && !picked && (
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
        </ul>
      )}
      {picked && (
        <button type="button" onClick={() => { setPicked(null); setQ(""); }}
          className="mt-1 text-xs text-ink-2 hover:underline">Change supplier</button>
      )}
    </div>
  );
}
