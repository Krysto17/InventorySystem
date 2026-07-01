"use client";

import { useActionState } from "react";
import { renameSupplier, saveSupplierAccount, type SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};

type Supplier = {
  id: string;
  name: string;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
};

// Manager/owner edit forms: rename the supplier and update their (editable)
// bank-account details. Previous names/accounts are kept as history server-side.
export function SupplierEditForms({ supplier }: { supplier: Supplier }) {
  const [nameState, renameAction, renaming] = useActionState(renameSupplier, init);
  const [acctState, acctAction, savingAcct] = useActionState(saveSupplierAccount, init);

  return (
    <div className="space-y-4">
      <form action={renameAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="supplier_id" value={supplier.id} />
        <label className="flex-1 text-xs font-medium">
          Supplier name
          <input name="name" defaultValue={supplier.name} required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <button type="submit" disabled={renaming} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
          {renaming ? "Saving…" : "Rename"}
        </button>
        {nameState.error && <p className="w-full text-xs text-red-600">{nameState.error}</p>}
        {nameState.ok && <p className="w-full text-xs text-green-700">{nameState.ok}</p>}
      </form>

      <form action={acctAction} className="space-y-2 border-t border-line pt-3">
        <input type="hidden" name="supplier_id" value={supplier.id} />
        <div className="text-xs font-medium text-ink-2">Bank account details (editable — changes are kept in history)</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input name="account_name" placeholder="Account name" defaultValue={supplier.account_name ?? ""} className="rounded border px-2 py-1 text-sm" />
          <input name="account_number" placeholder="Account number" defaultValue={supplier.account_number ?? ""} className="rounded border px-2 py-1 text-sm" />
          <input name="bank_name" placeholder="Bank" defaultValue={supplier.bank_name ?? ""} className="rounded border px-2 py-1 text-sm" />
        </div>
        <button type="submit" disabled={savingAcct} className="rounded border px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50">
          {savingAcct ? "Saving…" : "Save account details"}
        </button>
        {acctState.error && <p className="text-xs text-red-600">{acctState.error}</p>}
        {acctState.ok && <p className="text-xs text-green-700">{acctState.ok}</p>}
      </form>
    </div>
  );
}
