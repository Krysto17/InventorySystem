import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { createConsumable, recordConsumableMovement } from "./actions";

import { formatTimestamp } from "@/lib/visits/format";

export default async function ConsumablesPage() {
  const supabase = await createClient();

  const { data: consumables } = await supabase
    .from("consumables")
    .select(`
      id, name, on_hand, unit,
      movements:consumable_movements(
        id, delta, reason, created_at,
        recorded_by_profile:profiles!consumable_movements_recorded_by_fkey(full_name)
      )
    `)
    .order("name");

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/inventory" className="text-sm text-gray-500 hover:underline">
          ← Inventory
        </Link>
        <h1 className="text-2xl font-semibold">Consumables</h1>
      </div>

      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">Add consumable</h2>
        <form action={createConsumable} className="space-y-3 max-w-sm">
          <div>
            <label className="block text-sm font-medium">
              Name *
              <input
                type="text"
                name="name"
                required
                placeholder="e.g. Diesel, Lubricant, Sacks"
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Unit
              <input
                type="text"
                name="unit"
                placeholder="e.g. L, kg, pcs"
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-sm font-medium">
              Initial stock
              <input
                type="number"
                name="on_hand"
                defaultValue="0"
                min="0"
                step="0.001"
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-black text-white text-sm rounded"
          >
            Add
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Stock ({consumables?.length ?? 0} items)
        </h2>
        {!consumables || consumables.length === 0 ? (
          <p className="text-sm text-gray-600">No consumables added yet.</p>
        ) : (
          <div className="space-y-4">
            {consumables.map((c) => {
              const movements = (c as { movements: unknown[] }).movements ?? [];
              return (
                <div key={c.id as string} className="border rounded p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-medium">{c.name as string}</div>
                      <div className="text-sm text-gray-600">
                        On hand:{" "}
                        <strong>
                          {Number(c.on_hand).toFixed(3)}{" "}
                          {(c.unit as string | null) ?? "units"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <MovementForm consumableId={c.id as string} unit={(c.unit as string | null) ?? "units"} />

                  {movements.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-gray-500 cursor-pointer">
                        Movement history ({movements.length})
                      </summary>
                      <ul className="mt-2 text-xs space-y-1">
                        {movements.map((m) => {
                          const mv = m as {
                            id: string;
                            delta: number;
                            reason: string | null;
                            created_at: string;
                            recorded_by_profile: unknown;
                          };
                          const rec = mv.recorded_by_profile;
                          const recName =
                            (Array.isArray(rec)
                              ? (rec[0] as { full_name?: string })?.full_name
                              : (rec as { full_name?: string } | null)?.full_name) ?? "—";
                          const delta = Number(mv.delta);
                          return (
                            <li key={mv.id} className="flex justify-between">
                              <span>
                                <span
                                  className={
                                    delta >= 0 ? "text-green-700" : "text-red-700"
                                  }
                                >
                                  {delta >= 0 ? "+" : ""}
                                  {delta.toFixed(3)}
                                </span>
                                {mv.reason && (
                                  <span className="text-gray-500"> · {mv.reason}</span>
                                )}
                              </span>
                              <span className="text-gray-500">
                                {recName} · {formatTimestamp(mv.created_at)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function MovementForm({ consumableId, unit }: { consumableId: string; unit: string }) {
  return (
    <form action={recordConsumableMovement} className="flex flex-wrap gap-2 items-end">
      <input type="hidden" name="consumable_id" value={consumableId} />
      <label className="text-sm font-medium">
        Delta ({unit})
        <input
          type="number"
          name="delta"
          step="0.001"
          required
          placeholder="-10 to consume, +5 to restock"
          className="mt-1 block border rounded px-2 py-1 text-sm w-40"
        />
      </label>
      <label className="text-sm font-medium">
        Reason
        <input
          type="text"
          name="reason"
          placeholder="e.g. weekly use"
          className="mt-1 block border rounded px-2 py-1 text-sm w-36"
        />
      </label>
      <button
        type="submit"
        className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
      >
        Record
      </button>
    </form>
  );
}
