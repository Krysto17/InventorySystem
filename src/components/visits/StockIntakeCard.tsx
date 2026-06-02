"use client";

import { useActionState } from "react";
import { recordPurchaseIntake, type IntakeState } from "@/app/(inventory)/inventory/actions";
import { formatWeight, formatTimestamp } from "@/lib/visits/format";

type StockMovement = {
  id: string;
  weight: number;
  grade: string | null;
  created_at: string;
  recorded_by_name: string | null;
};

type Props = {
  visitId: string;
  visitState: string;
  analysisWeight: number | null;
  analysisGrade: string | null;
  canWrite: boolean;
  stockMovement: StockMovement | null;
};

const initial: IntakeState = {};

export function StockIntakeCard({
  visitId,
  visitState,
  analysisWeight,
  analysisGrade,
  canWrite,
  stockMovement,
}: Props) {
  const [state, action, pending] = useActionState(recordPurchaseIntake, initial);

  if (stockMovement) {
    return (
      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Stock intake</div>
        <div className="text-sm">
          Received: <strong>{formatWeight(stockMovement.weight)}</strong>
          {stockMovement.grade && (
            <>
              {" "}· Grade: <strong>{stockMovement.grade}</strong>
            </>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {stockMovement.recorded_by_name ?? "—"} · {formatTimestamp(stockMovement.created_at)}
        </div>
      </section>
    );
  }

  if (visitState !== "awaiting_stock_intake" || !canWrite) {
    return (
      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Stock intake</div>
        <p className="text-sm text-gray-600">Pending stock intake.</p>
      </section>
    );
  }

  return (
    <section className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500 mb-2">Receive into stock</div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="visit_id" value={visitId} />
        <div>
          <label className="block text-sm font-medium">
            Weight (kg)
            <input
              type="number"
              name="weight"
              step="0.001"
              min="0.001"
              defaultValue={analysisWeight ?? ""}
              required
              className="mt-1 block w-full border rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium">
            Grade
            <input
              type="text"
              name="grade"
              defaultValue={analysisGrade ?? ""}
              placeholder="e.g. A, B+, 65% pure"
              className="mt-1 block w-full border rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-black text-white text-sm rounded disabled:opacity-50"
        >
          {pending ? "Saving…" : "Take into stock"}
        </button>
      </form>
    </section>
  );
}
