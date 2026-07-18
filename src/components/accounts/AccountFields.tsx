"use client";

import { useMemo, useState } from "react";
import type { KnownAccount } from "@/lib/accounts/known-accounts";

// Reusable account-details block (name · number · bank) with autofill: start
// typing an account name and pick a match to fill the number + bank. Uses a
// small in-flow suggestion list (NOT a native <datalist>, which renders as a
// full-screen overlay over the keyboard on phones/tablets).
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
  const [name, setName] = useState(defaultName ?? "");
  const [number, setNumber] = useState(defaultNumber ?? "");
  const [bank, setBank] = useState(defaultBank ?? "");
  const [open, setOpen] = useState(false);

  const field = "mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm";

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    return accounts
      .filter((a) => a.name.toLowerCase().includes(q) && a.name.toLowerCase() !== q)
      .slice(0, 6);
  }, [accounts, name]);

  function pick(a: KnownAccount) {
    setName(a.name); setNumber(a.number); setBank(a.bank); setOpen(false);
  }
  function onName(v: string) {
    setName(v); setOpen(true);
    const hit = accounts.find((a) => a.name.toLowerCase() === v.trim().toLowerCase());
    if (hit) { setNumber(hit.number); setBank(hit.bank); }
  }
  function onNumber(v: string) {
    setNumber(v);
    const hit = accounts.find((a) => a.number === v.trim());
    if (hit) { if (!name.trim()) setName(hit.name); setBank(hit.bank); }
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-medium text-ink-2">{label}</div>}

      <label className="block text-xs font-medium">Account name
        <div className="relative">
          <input
            name="account_name" value={name}
            onChange={(e) => onName(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off" placeholder="Start typing…" className={field}
          />
          {open && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-auto rounded border border-line bg-paper shadow-lg">
              {suggestions.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    // onMouseDown fires before the input's blur, so the pick registers.
                    onMouseDown={(e) => { e.preventDefault(); pick(a); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="block text-xs text-ink-2">{a.bank} · {a.number}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
