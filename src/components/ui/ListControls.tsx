"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type ToggleOption = { value: string; label: string };

/**
 * Search box + status toggles for a list, driven by the URL.
 *
 * The filtering happens in Postgres, so the page only ever holds the matches —
 * these lists are capped at a page of rows, and filtering in the browser would
 * only ever search the newest page rather than the whole ledger.
 */
export function ListControls({
  basePath,
  query = "",
  status = "",
  options,
  placeholder = "Search…",
}: {
  basePath: string;
  query?: string;
  status?: string;
  options: ToggleOption[];
  placeholder?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState(query);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    router.push(`${basePath}${p.toString() ? `?${p}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <form
        data-confirm="skip"
        onSubmit={(e) => { e.preventDefault(); go({ q: draft }); }}
        className="flex items-center gap-1"
      >
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full max-w-xs rounded border px-3 py-1.5 text-sm"
          autoComplete="off"
        />
        <button type="submit" className="rounded border px-2 py-1.5 text-xs hover:bg-zinc-50">
          Search
        </button>
        {query && (
          <button type="button" onClick={() => { setDraft(""); go({ q: "" }); }}
            className="px-1 text-xs text-ink-2 hover:underline">
            Clear
          </button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-1">
        {options.map((o) => (
          <button
            key={o.value || "all"}
            type="button"
            onClick={() => go({ status: o.value })}
            aria-pressed={status === o.value}
            className={`rounded px-2 py-1 text-xs ${
              status === o.value ? "bg-black text-white" : "border hover:bg-zinc-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
