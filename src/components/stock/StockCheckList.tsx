"use client";

import { useActionState, useState } from "react";
import { confirmLot, disputeLot, clearCheck } from "@/app/(stock-keeper)/stock-keeper/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionResult } from "@/lib/actions/result";

export type LotRow = {
  id: string;
  material: string;
  weightKg: number;
  takenInAt: string;
  status: "unchecked" | "confirmed" | "disputed";
  countedWeightKg: number | null;
  disputeNote: string | null;
};

const init: ActionResult = { ok: false };
const kg = (n: number) => `${n.toFixed(3)} kg`;

// Raising a dispute: what was actually found, and what is wrong with it.
function DisputeForm({ lot, onDone }: { lot: LotRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(disputeLot, init);
  if (state.ok) onDone();
  return (
    <form action={action} className="mt-2 space-y-2 rounded border border-reject/40 bg-reject-soft/30 p-2">
      <input type="hidden" name="stock_lot_id" value={lot.id} />
      <label className="block text-xs font-medium">
        Weight actually found (kg) — leave blank if nothing is there
        <input type="number" name="counted_weight_kg" step="0.001" min="0"
          defaultValue={lot.countedWeightKg ?? ""}
          className="mt-1 block w-40 rounded border px-2 py-1 text-sm" />
      </label>
      <label className="block text-xs font-medium">
        What is wrong? *
        <textarea name="dispute_note" rows={2} required defaultValue={lot.disputeNote ?? ""}
          placeholder="e.g. Not in the store at all, or 40kg short of the books"
          className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      {state.error && <p className="text-xs text-reject">{state.error}</p>}
      <div className="flex gap-2">
        <SubmitButton pendingText="Saving…" className="rounded bg-reject px-3 py-1 text-xs text-white disabled:opacity-50">
          Raise dispute
        </SubmitButton>
        <button type="button" onClick={onDone} disabled={pending}
          className="px-2 text-xs text-ink-2 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

function LotCard({ lot }: { lot: LotRow }) {
  const [disputing, setDisputing] = useState(false);
  const short = lot.countedWeightKg != null && Math.abs(lot.countedWeightKg - lot.weightKg) > 0.0005;

  return (
    <li className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-medium">{lot.material}</span>
          <span className="block text-xs text-ink-2">
            Taken in {new Date(lot.takenInAt).toLocaleDateString()} · lot {lot.id.slice(0, 8)}
          </span>
        </div>
        <div className="text-right">
          <span className="mono font-semibold">{kg(lot.weightKg)}</span>
          {lot.status === "confirmed" && (
            <span className="ml-2 rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">✓ In store</span>
          )}
          {lot.status === "disputed" && (
            <span className="ml-2 rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white">Disputed</span>
          )}
        </div>
      </div>

      {lot.status === "disputed" && lot.disputeNote && (
        <p className="mt-1 text-xs text-reject">
          {lot.disputeNote}
          {lot.countedWeightKg != null && ` · found ${kg(lot.countedWeightKg)}`}
        </p>
      )}
      {lot.status === "confirmed" && short && (
        <p className="mt-1 text-xs text-ink-2">Counted {kg(lot.countedWeightKg!)} against {kg(lot.weightKg)} on the books.</p>
      )}

      {disputing ? (
        <DisputeForm lot={lot} onDone={() => setDisputing(false)} />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {lot.status === "unchecked" ? (
            <>
              <form action={confirmLot} data-confirm="skip" className="flex items-end gap-2">
                <input type="hidden" name="stock_lot_id" value={lot.id} />
                <label className="text-[11px] font-medium text-ink-2">
                  Counted (kg)
                  <input type="number" name="counted_weight_kg" step="0.001" min="0"
                    defaultValue={lot.weightKg}
                    className="mt-1 block w-32 rounded border px-2 py-1 text-sm" />
                </label>
                <SubmitButton pendingText="…" className="rounded bg-approve px-3 py-1.5 text-xs text-white disabled:opacity-50">
                  ✓ It is in the store
                </SubmitButton>
              </form>
              <button type="button" onClick={() => setDisputing(true)}
                className="rounded border border-reject px-3 py-1.5 text-xs text-reject hover:bg-reject-soft">
                Set dispute
              </button>
            </>
          ) : (
            <form action={clearCheck} data-confirm="Undo this check and put the lot back on the list?">
              <input type="hidden" name="stock_lot_id" value={lot.id} />
              <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-[11px] text-ink-2 hover:bg-zinc-50 disabled:opacity-50">
                Undo check
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

// The store keeper walks the store with this: everything the books say is in
// stock, ticked off one lot at a time.
export function StockCheckList({ lots }: { lots: LotRow[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "unchecked" | "disputed">("all");

  const t = q.trim().toLowerCase();
  const shown = lots.filter((l) => {
    if (only === "unchecked" && l.status !== "unchecked") return false;
    if (only === "disputed" && l.status !== "disputed") return false;
    if (!t) return true;
    return l.material.toLowerCase().includes(t) || String(l.weightKg).includes(t);
  });

  const counts = {
    unchecked: lots.filter((l) => l.status === "unchecked").length,
    confirmed: lots.filter((l) => l.status === "confirmed").length,
    disputed: lots.filter((l) => l.status === "disputed").length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search material or weight…"
          className="w-full max-w-xs rounded border px-2 py-1 text-sm" autoComplete="off" />
        {(["all", "unchecked", "disputed"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setOnly(k)}
            className={`rounded px-2 py-1 text-xs ${only === k ? "bg-black text-white" : "border hover:bg-zinc-50"}`}>
            {k === "all" ? `All (${lots.length})` : k === "unchecked" ? `Not checked (${counts.unchecked})` : `Disputed (${counts.disputed})`}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-2">
        {counts.confirmed} of {lots.length} confirmed in the store
        {counts.disputed > 0 ? ` · ${counts.disputed} disputed` : ""}
      </p>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-2">Nothing to show here.</p>
      ) : (
        <ul className="space-y-2">{shown.map((l) => <LotCard key={l.id} lot={l} />)}</ul>
      )}
    </div>
  );
}
