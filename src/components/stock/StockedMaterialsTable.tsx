"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmLot, disputeLot, clearCheck } from "@/app/stocked-materials/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionResult } from "@/lib/actions/result";

export type StockedRow = {
  id: string;
  date: string;
  supplier: string;
  supplierCode: string | null;
  material: string;
  weight: number;
  site: string;
  paid: "Paid" | "Unpaid" | "—";
  inStock: boolean;
  check: "unchecked" | "confirmed" | "disputed";
  counted: number | null;
  disputeNote: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
};

type SortKey = "date" | "material" | "paid" | "supplier" | "weight" | "check";

const init: ActionResult = { ok: false };
const kg = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

// Only material the company has paid for can be confirmed into the store — an
// unpaid lot is not yet ours to count.
function checkable(r: StockedRow) {
  return r.inStock && r.paid === "Paid";
}

function DisputeForm({ row, onDone }: { row: StockedRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(disputeLot, init);
  if (state.ok) onDone();
  return (
    <form action={action} className="space-y-2 rounded border border-reject/40 bg-reject-soft/30 p-2">
      <input type="hidden" name="stock_lot_id" value={row.id} />
      <label className="block text-[11px] font-medium">
        Weight found (kg) — blank if nothing is there
        <input type="number" name="counted_weight_kg" step="0.001" min="0" defaultValue={row.counted ?? ""}
          className="mt-1 block w-32 rounded border px-2 py-1 text-sm" />
      </label>
      <label className="block text-[11px] font-medium">
        What is wrong? *
        <textarea name="dispute_note" rows={2} required defaultValue={row.disputeNote ?? ""}
          placeholder="e.g. Not in the store, or 40kg short"
          className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      {state.error && <p className="text-[11px] text-reject">{state.error}</p>}
      <div className="flex gap-2">
        <SubmitButton pendingText="…" className="rounded bg-reject px-2 py-1 text-[11px] text-white disabled:opacity-50">
          Raise dispute
        </SubmitButton>
        <button type="button" onClick={onDone} disabled={pending} className="text-[11px] text-ink-2 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function CheckCell({ row, canCheck }: { row: StockedRow; canCheck: boolean }) {
  const [disputing, setDisputing] = useState(false);

  const badge =
    row.check === "confirmed"
      ? <span className="rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">✓ In store</span>
      : row.check === "disputed"
        ? <span className="rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white">Disputed</span>
        : null;

  const detail = (
    <>
      {row.check === "disputed" && row.disputeNote && (
        <span className="block text-[11px] text-reject">{row.disputeNote}</span>
      )}
      {row.counted != null && Math.abs(row.counted - row.weight) > 0.0005 && (
        <span className="block text-[11px] text-ink-2">Counted {kg(row.counted)} kg</span>
      )}
      {row.checkedBy && (
        <span className="block text-[10px] text-ink-2">
          {row.checkedBy}{row.checkedAt ? ` · ${row.checkedAt.slice(0, 10)}` : ""}
        </span>
      )}
    </>
  );

  if (!checkable(row)) {
    return (
      <span className="text-[11px] text-ink-2">
        {badge ?? (row.inStock ? "awaiting payment" : "—")}
        {badge && detail}
      </span>
    );
  }

  if (!canCheck) return <span>{badge ?? <span className="text-[11px] text-ink-2">not counted</span>}{detail}</span>;

  if (disputing) return <DisputeForm row={row} onDone={() => setDisputing(false)} />;

  if (row.check === "unchecked") {
    return (
      <span className="flex flex-wrap items-end gap-1.5">
        <form action={confirmLot} data-confirm="skip" className="flex items-end gap-1.5">
          <input type="hidden" name="stock_lot_id" value={row.id} />
          <input type="number" name="counted_weight_kg" step="0.001" min="0" defaultValue={row.weight}
            aria-label="Counted kg" className="w-24 rounded border px-2 py-1 text-xs" />
          <SubmitButton pendingText="…" className="rounded bg-approve px-2 py-1 text-[11px] text-white disabled:opacity-50">
            ✓ In store
          </SubmitButton>
        </form>
        <button type="button" onClick={() => setDisputing(true)}
          className="rounded border border-reject px-2 py-1 text-[11px] text-reject hover:bg-reject-soft">
          Dispute
        </button>
      </span>
    );
  }

  return (
    <span>
      {badge}
      {detail}
      <form action={clearCheck} data-confirm="Undo this check?" className="mt-1">
        <input type="hidden" name="stock_lot_id" value={row.id} />
        <SubmitButton pendingText="…" className="rounded border px-1.5 py-0.5 text-[10px] text-ink-2 hover:bg-zinc-50 disabled:opacity-50">
          Undo
        </SubmitButton>
      </form>
    </span>
  );
}

// Every stocked material — supplier, type, weight, paid status — and the store
// check against it. Whoever counts the store ticks a lot off right here.
export function StockedMaterialsTable({
  rows, canCheck = false, query = "", only = "", includeSold = false,
}: {
  rows: StockedRow[];
  canCheck?: boolean;
  query?: string;
  only?: string;
  includeSold?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  // The search box and the filter chips are URL state: the log grows with every
  // lot, so Postgres does the filtering and the page only ever holds a page of
  // rows. Sorting stays client-side — it reorders what is already here.
  const [draft, setDraft] = useState(query);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    router.push(`/stocked-materials${p.toString() ? `?${p}` : ""}`);
  };

  const view = useMemo(() => {
    return [...rows].sort((a, b) => {
      const cmp =
        sortKey === "weight"
          ? a.weight - b.weight
          : String(a[sortKey]).localeCompare(String(b[sortKey]));
      return asc ? cmp : -cmp;
    });
  }, [rows, sortKey, asc]);

  const totalWeight = view.reduce((s, r) => s + r.weight, 0);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(key === "weight" ? false : true); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ▲" : " ▼") : "");
  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-4 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(key)} className="font-medium hover:underline">
        {label}{arrow(key)}
      </button>
    </th>
  );

  const badge = (paid: StockedRow["paid"]) =>
    paid === "Paid"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : paid === "Unpaid"
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          data-confirm="skip"
          onSubmit={(e) => { e.preventDefault(); go({ q: draft }); }}
          className="flex items-center gap-1"
        >
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search supplier, material, site…"
            className="w-full max-w-xs rounded border px-3 py-1.5 text-sm"
            autoComplete="off"
          />
          <button type="submit" className="rounded border px-2 py-1.5 text-xs hover:bg-zinc-50">Search</button>
          {query && (
            <button type="button" onClick={() => { setDraft(""); go({ q: "" }); }}
              className="px-1 text-xs text-ink-2 hover:underline">Clear</button>
          )}
        </form>
        {([["", "All"], ["uncounted", "Not counted"], ["disputed", "Disputed"]] as const).map(([k, label]) => (
          <button key={k || "all"} type="button" onClick={() => go({ only: k })}
            className={`rounded px-2 py-1 text-xs ${only === k ? "bg-black text-white" : "border hover:bg-zinc-50"}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">
          {view.length} lots{includeSold ? "" : " in stock"} · <span className="font-semibold text-ink">{kg(totalWeight)} kg</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-xs text-zinc-500">
            <tr>
              {th("date", "Date stocked")}
              {th("supplier", "Supplier")}
              {th("material", "Material")}
              {th("weight", "Weight (kg)", true)}
              {th("paid", "Status")}
              {th("check", "Store check")}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-3 text-zinc-500">No stocked materials.</td></tr>
            ) : view.map((r) => (
              <tr key={r.id} className="border-b border-line/60 align-top">
                <td className="px-4 py-2 whitespace-nowrap">{r.date.slice(0, 10)}</td>
                <td className="px-4 py-2">
                  {r.supplier}
                  {r.supplierCode && <span className="ml-1 text-xs text-zinc-400">{r.supplierCode}</span>}
                  <div className="text-xs text-zinc-400">{r.site}</div>
                </td>
                <td className="px-4 py-2">{r.material}</td>
                <td className="px-4 py-2 text-right">{kg(r.weight)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${badge(r.paid)}`}>{r.paid}</span>
                  {!r.inStock && <div className="text-[10px] text-zinc-400">out of stock</div>}
                </td>
                <td className="px-4 py-2"><CheckCell row={r} canCheck={canCheck} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
