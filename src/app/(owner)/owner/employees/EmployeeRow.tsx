"use client";

import { useActionState } from "react";
import { setEmployeeStatus } from "./actions";

export type EmployeeRowData = {
  id: string;
  full_name: string;
  username: string;
  role: string;
  site: string | null;
  status: "active" | "disabled";
};

export function EmployeeRow({ e, isSelf }: { e: EmployeeRowData; isSelf: boolean }) {
  const [state, action, pending] = useActionState(setEmployeeStatus, null);
  const disabled = e.status === "disabled";
  const nextStatus = disabled ? "active" : "disabled";

  return (
    <li className="flex flex-col gap-2 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={disabled ? "opacity-60" : ""}>
          <span className="font-medium">{e.full_name}</span>
          <span className="ml-2 text-zinc-500">@{e.username}</span>
          <span className="ml-2 mono text-[11px] uppercase tracking-[0.05em] text-ore">{e.role}</span>
          {e.site && <span className="ml-2 text-zinc-500">· {e.site}</span>}
          {disabled && (
            <span className="ml-2 rounded bg-reject-soft px-1.5 py-0.5 text-[11px] text-reject">disabled</span>
          )}
          {isSelf && <span className="ml-2 text-[11px] text-zinc-500">(you)</span>}
        </div>
        {isSelf ? (
          <span className="text-xs text-zinc-400">—</span>
        ) : (
          <form action={action}>
            <input type="hidden" name="userId" value={e.id} />
            <input type="hidden" name="status" value={nextStatus} />
            <button
              disabled={pending}
              className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                disabled
                  ? "border-approve text-approve hover:bg-approve-soft"
                  : "border-reject text-reject hover:bg-reject-soft"
              }`}
            >
              {pending ? "…" : disabled ? "Enable" : "Disable"}
            </button>
          </form>
        )}
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-approve">{state.ok}</p>}
    </li>
  );
}
