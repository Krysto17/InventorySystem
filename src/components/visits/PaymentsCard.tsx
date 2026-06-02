"use client";

import { useActionState } from "react";
import {
  recordPayment,
  toggleProcessingDeducted,
  settleVisit,
  type PaymentState,
} from "@/app/(accounting)/accounting/actions";
import { formatNaira, formatTimestamp } from "@/lib/visits/format";

type Payment = {
  id: string;
  direction: "processing_fee_in" | "purchase_amount_out";
  amount: number;
  method: string | null;
  notes: string | null;
  paid_at: string;
  recorded_by_name: string | null;
};

type BalanceSummary = {
  processingFeeOwed: number | null;
  processingFeePaid: number;
  purchaseAmountOwed: number | null;
  purchaseAmountPaid: number;
  processingDeducted: boolean;
};

const initial: PaymentState = {};

export function PaymentsCard({
  visitId,
  visitState,
  payments,
  balance,
  canWrite,
}: {
  visitId: string;
  visitState: string;
  payments: Payment[];
  balance: BalanceSummary;
  canWrite: boolean;
}) {
  const [payState, payAction, payPending] = useActionState(recordPayment, initial);
  const [deductState, deductAction] = useActionState(toggleProcessingDeducted, initial);
  const [settleState, settleAction, settlePending] = useActionState(settleVisit, initial);

  const inAccounting = visitState === "in_accounting";

  const processingBalance =
    balance.processingFeeOwed != null
      ? balance.processingFeeOwed - balance.processingFeePaid
      : null;
  const purchaseBalance =
    balance.purchaseAmountOwed != null
      ? balance.purchaseAmountOwed - balance.purchaseAmountPaid
      : null;
  const netBalance =
    balance.processingDeducted && balance.processingFeeOwed != null && balance.purchaseAmountOwed != null
      ? balance.purchaseAmountOwed - balance.processingFeeOwed - balance.purchaseAmountPaid
      : null;

  return (
    <section className="border rounded p-4 space-y-4">
      <div className="text-xs uppercase text-gray-500">Payments</div>

      {/* Balance summary */}
      <div className="text-sm space-y-1">
        {balance.processingFeeOwed != null && (
          <div>
            Processing fee:{" "}
            <strong>{formatNaira(balance.processingFeeOwed)}</strong> owed ·{" "}
            {formatNaira(balance.processingFeePaid)} paid ·{" "}
            <span className={processingBalance! > 0 ? "text-red-600" : "text-green-600"}>
              {formatNaira(processingBalance)} remaining
            </span>
          </div>
        )}
        {balance.purchaseAmountOwed != null && (
          <div>
            Purchase amount:{" "}
            <strong>{formatNaira(balance.purchaseAmountOwed)}</strong> owed ·{" "}
            {formatNaira(balance.purchaseAmountPaid)} paid ·{" "}
            <span className={purchaseBalance! > 0 ? "text-red-600" : "text-green-600"}>
              {formatNaira(purchaseBalance)} remaining
            </span>
          </div>
        )}
        {balance.processingDeducted && netBalance != null && (
          <div className="text-gray-600 text-xs">
            (Deducted) Net payout: {formatNaira(netBalance)}
          </div>
        )}
      </div>

      {/* Processing-deducted toggle */}
      {canWrite && balance.processingFeeOwed != null && balance.purchaseAmountOwed != null && inAccounting && (
        <form action={deductAction} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="visit_id" value={visitId} />
          <input
            type="hidden"
            name="processing_deducted"
            value={balance.processingDeducted ? "false" : "true"}
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={balance.processingDeducted}
              onChange={() => {}}
              readOnly
            />
            Deduct processing fee from purchase amount
          </label>
          <button type="submit" className="text-xs underline">
            {balance.processingDeducted ? "Un-deduct" : "Deduct"}
          </button>
          {deductState.error && (
            <span className="text-red-600 text-xs">{deductState.error}</span>
          )}
        </form>
      )}

      {/* Payment log */}
      {payments.length > 0 && (
        <ul className="divide-y text-sm">
          {payments.map((p) => (
            <li key={p.id} className="py-2">
              <div className="flex justify-between">
                <span>
                  {p.direction === "processing_fee_in" ? "↑ Fee in" : "↓ Purchase out"} ·{" "}
                  <strong>{formatNaira(p.amount)}</strong>
                  {p.method && <span className="text-gray-500"> ({p.method})</span>}
                </span>
                <span className="text-xs text-gray-500">{formatTimestamp(p.paid_at)}</span>
              </div>
              {p.notes && <div className="text-xs text-gray-600">{p.notes}</div>}
              <div className="text-xs text-gray-400">{p.recorded_by_name ?? "—"}</div>
            </li>
          ))}
        </ul>
      )}

      {/* Record payment form */}
      {canWrite && (
        <form action={payAction} className="space-y-2 border-t pt-3">
          <input type="hidden" name="visit_id" value={visitId} />
          <div className="flex gap-2 items-end">
            <label className="flex flex-col text-sm flex-1">
              Direction
              <select name="direction" required className="border rounded px-2 py-1">
                {balance.processingFeeOwed != null && (
                  <option value="processing_fee_in">Processing fee (in)</option>
                )}
                {balance.purchaseAmountOwed != null && visitState !== "exited" && (
                  <option value="purchase_amount_out">Purchase amount (out)</option>
                )}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              Amount (₦)
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="border rounded px-2 py-1 w-32"
              />
            </label>
            <label className="flex flex-col text-sm">
              Method
              <select name="method" className="border rounded px-2 py-1">
                <option value="">—</option>
                <option value="cash">Cash</option>
                <option value="transfer">Transfer</option>
                <option value="deduction">Deduction</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <input
            name="notes"
            placeholder="Notes (optional)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          {payState.error && <p className="text-red-600 text-xs">{payState.error}</p>}
          <button
            type="submit"
            disabled={payPending}
            className="px-3 py-2 bg-black text-white rounded text-sm"
          >
            {payPending ? "Recording..." : "Record payment"}
          </button>
        </form>
      )}

      {/* Settle button */}
      {canWrite && inAccounting && (
        <form action={settleAction} className="border-t pt-3">
          <input type="hidden" name="visit_id" value={visitId} />
          {settleState.error && (
            <p className="text-red-600 text-xs mb-2">{settleState.error}</p>
          )}
          <button
            type="submit"
            disabled={settlePending}
            className="px-3 py-2 bg-green-700 text-white rounded text-sm"
          >
            {settlePending ? "Settling..." : "Mark settled → Awaiting stock intake"}
          </button>
        </form>
      )}
    </section>
  );
}
