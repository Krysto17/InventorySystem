"use client";

import { useActionState } from "react";
import { resetEmployeePassword } from "./actions";

export type EmployeeRowData = {
  id: string;
  full_name: string;
  username: string;
  role: string;
  site: string | null;
  must_change_password: boolean;
};

export function EmployeeRow({ e }: { e: EmployeeRowData }) {
  const [state, action, pending] = useActionState(resetEmployeePassword, null);
  return (
    <li className="flex flex-col gap-2 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{e.full_name}</span>
          <span className="ml-2 text-zinc-500">@{e.username}</span>
          <span className="ml-2 mono text-[11px] uppercase tracking-[0.05em] text-ore">{e.role}</span>
          {e.site && <span className="ml-2 text-zinc-500">· {e.site}</span>}
          {e.must_change_password && (
            <span className="ml-2 rounded bg-pending-soft px-1.5 py-0.5 text-[11px] text-pending">temp pw pending</span>
          )}
        </div>
        <form action={action}>
          <input type="hidden" name="userId" value={e.id} />
          <button
            disabled={pending}
            className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            {pending ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && (
        <p className="rounded bg-approve-soft px-2 py-1 text-xs font-medium text-approve">{state.ok}</p>
      )}
    </li>
  );
}
