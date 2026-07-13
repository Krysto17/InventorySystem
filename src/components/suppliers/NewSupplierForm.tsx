"use client";

import { useActionState } from "react";
import { createSupplier, type SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};

// Register a supplier on its own — no visit needed. Collapsed by default so it
// stays out of the way of the searchable directory.
export function NewSupplierForm() {
  const [state, action, pending] = useActionState(createSupplier, init);

  return (
    <details className="rounded border border-line">
      <summary className="cursor-pointer px-4 py-2 text-sm font-semibold">
        + New supplier
      </summary>
      <form action={action} className="space-y-3 border-t border-line p-4">
        <p className="text-xs text-gray-500">
          Save a supplier without starting a visit. Bank/account details can be added on
          their page afterwards.
        </p>
        <label className="block text-xs font-medium">
          Supplier name<span className="text-red-600"> *</span>
          <input
            name="name"
            required
            placeholder="e.g. Ahmed Musa"
            className="mt-1 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium">
            Phone <span className="font-normal text-gray-400">(optional)</span>
            <input name="phone" inputMode="tel" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-xs font-medium">
            Notes <span className="font-normal text-gray-400">(optional)</span>
            <input name="notes" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save supplier"}
        </button>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      </form>
    </details>
  );
}
