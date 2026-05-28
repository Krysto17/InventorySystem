"use client";

import { useActionState } from "react";
import { addEmployee } from "./actions";

export function AddEmployeeForm({
  sites, roles,
}: { sites: { id: string; name: string }[]; roles: string[] }) {
  const [state, action, pending] = useActionState(addEmployee, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input name="fullName" placeholder="Full name" required className="rounded border p-2" />
      <input name="username" placeholder="Username" required className="rounded border p-2" />
      <select name="role" required className="rounded border p-2">
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select name="siteId" className="rounded border p-2">
        <option value="">— site (leave blank for owner) —</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? "Creating…" : "Create employee"}
      </button>
    </form>
  );
}
