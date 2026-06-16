"use client";

import { useActionState, useState } from "react";
import { submitPricing, type PricingState } from "@/app/(manager)/manager/actions";
import { formatNaira, formatWeight } from "@/lib/visits/format";

type ExistingPricing = {
  id: string;
  unit_price: number | null;
  agreement_status: "pending" | "agreed" | "not_agreed";
  payment_terms: "immediate" | "deferred" | "installment" | "deducted" | null;
};

const initial: PricingState = {};

export function PricingCard({
  visitId,
  analysisWeight,
  existing,
}: {
  visitId: string;
  analysisWeight: number;
  existing?: ExistingPricing | null;
}) {
  const [state, action, pending] = useActionState(submitPricing, initial);
  const [unitPrice, setUnitPrice] = useState<string>(existing?.unit_price?.toString() ?? "");
  const [status, setStatus] = useState(existing?.agreement_status ?? "pending");
  const [terms, setTerms] = useState<string>(existing?.payment_terms ?? "");

  const purchaseAmount = unitPrice ? Number(unitPrice) * analysisWeight : null;

  return (
    <form action={action} className="space-y-3 max-w-lg">
      <input type="hidden" name="visit_id" value={visitId} />
      {existing && <input type="hidden" name="record_id" value={existing.id} />}

      <div className="text-sm text-gray-600">
        Analysis weight: {formatWeight(analysisWeight)}
      </div>

      <label className="flex flex-col text-sm">
        Unit price (₦ per kg)
        <input
          name="unit_price"
          type="number"
          step="0.01"
          min="0"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </label>

      <div className="text-sm">
        Purchase amount: <strong>{formatNaira(purchaseAmount)}</strong>
      </div>

      <fieldset className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="agreement_status"
            value="pending"
            checked={status === "pending"}
            onChange={() => setStatus("pending")}
          />{" "}
          Pending
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="agreement_status"
            value="agreed"
            checked={status === "agreed"}
            onChange={() => setStatus("agreed")}
          />{" "}
          Agreed
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="agreement_status"
            value="not_agreed"
            checked={status === "not_agreed"}
            onChange={() => setStatus("not_agreed")}
          />{" "}
          No agreement
        </label>
      </fieldset>

      {status === "agreed" && (
        <label className="flex flex-col text-sm">
          Payment terms *
          <select
            name="payment_terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            required
            className="border rounded px-2 py-1"
          >
            <option value="">— select —</option>
            <option value="immediate">Immediate</option>
            <option value="deferred">Deferred (pay later)</option>
            <option value="installment">Installments</option>
            <option value="deducted">Deduct from processing fee</option>
          </select>
        </label>
      )}

      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="px-3 py-2 bg-black text-white rounded"
      >
        {pending ? "Saving..." : existing ? "Update pricing" : "Submit pricing"}
      </button>
    </form>
  );
}
