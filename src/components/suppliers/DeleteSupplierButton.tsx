"use client";

import { useActionState } from "react";
import { deleteSupplier, type SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};

// Manager/owner deletes a supplier that has no records. Disabled with an
// explanatory note when the supplier is referenced anywhere.
export function DeleteSupplierButton({
  supplierId,
  hasRecords,
}: {
  supplierId: string;
  hasRecords: boolean;
}) {
  const [state, action, pending] = useActionState(deleteSupplier, init);

  if (hasRecords) {
    return (
      <p className="text-xs text-gray-500">
        This supplier has records (visits, advances or stock) and can&rsquo;t be deleted.
      </p>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this supplier? This cannot be undone.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="supplier_id" value={supplierId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/40"
      >
        {pending ? "Deleting…" : "Delete supplier"}
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
