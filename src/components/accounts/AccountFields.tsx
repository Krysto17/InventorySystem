"use client";

import { useId, useState } from "react";
import type { KnownAccount } from "@/lib/accounts/known-accounts";

// Reusable account-details block (name · number · bank) with autofill: start
// typing an account name and, when it matches one already used in the app, the
// account number and bank fill in automatically. Used everywhere account details
// are entered so the trio always stays linked.
export function AccountFields({
  accounts,
  defaultName = null,
  defaultNumber = null,
  defaultBank = null,
  label = "Account details (pay to)",
}: {
  accounts: KnownAccount[];
  defaultName?: string | null;
  defaultNumber?: string | null;
  defaultBank?: string | null;
  label?: string | null;
}) {
  const listId = useId();
  const [name, setName] = useState(defaultName ?? "");
  const [number, setNumber] = useState(defaultNumber ?? "");
  const [bank, setBank] = useState(defaultBank ?? "");

  const field = "mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm";

  function onName(v: string) {
    setName(v);
    const hit = accounts.find((a) => a.name.toLowerCase() === v.trim().toLowerCase());
    if (hit) { setNumber(hit.number); setBank(hit.bank); }
  }
  // If the number is completed to a known account, backfill name + bank too.
  function onNumber(v: string) {
    setNumber(v);
    const hit = accounts.find((a) => a.number === v.trim());
    if (hit) { if (!name.trim()) setName(hit.name); setBank(hit.bank); }
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-medium text-ink-2">{label}</div>}
      <label className="block text-xs font-medium">Account name
        <input list={listId} name="account_name" value={name} onChange={(e) => onName(e.target.value)}
          autoComplete="off" placeholder="Start typing…" className={field} />
        <datalist id={listId}>
          {accounts.map((a, i) => <option key={i} value={a.name}>{a.bank} · {a.number}</option>)}
        </datalist>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block text-xs font-medium">Account number <span className="font-normal text-gray-400">(10 digits)</span>
          <input name="account_number" value={number} onChange={(e) => onNumber(e.target.value)}
            inputMode="numeric" pattern="\d{10}" maxLength={10} autoComplete="off" className={field} />
        </label>
        <label className="block text-xs font-medium">Bank name
          <input name="bank_name" value={bank} onChange={(e) => setBank(e.target.value)} autoComplete="off" className={field} />
        </label>
      </div>
    </div>
  );
}
