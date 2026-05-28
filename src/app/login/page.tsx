"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">MAGNETIC JOEZION NIG. LTD</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="username" placeholder="Username" required
          className="rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required
          className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
