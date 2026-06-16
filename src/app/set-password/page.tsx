"use client";

import { useActionState } from "react";
import { setPassword } from "./actions";

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="password" type="password" placeholder="New password" required
          className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
