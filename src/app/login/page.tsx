"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="bg-rule flex min-h-screen items-center justify-center p-6">
      <div className="shadow-offset w-[min(420px,92vw)] border-[1.5px] border-ink bg-panel">
        <div className="flex items-baseline justify-between border-b-[1.5px] border-ink px-6 py-5">
          <div className="text-xl font-extrabold tracking-tight text-ink">
            Magnetic<span className="text-ore">Joezion</span>
          </div>
          <div className="mono text-[10px] text-ink-2">INVENTORY · LEDGER</div>
        </div>

        <form action={action} className="flex flex-col gap-4 p-6">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2">
              Username
            </label>
            <input
              name="username"
              required
              autoComplete="username"
              className="mono w-full rounded border-[1.5px] border-line bg-panel p-2.5 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ore"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mono w-full rounded border-[1.5px] border-line bg-panel p-2.5 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ore"
            />
          </div>

          {state?.error && <p className="text-sm font-medium text-reject">{state.error}</p>}

          <button
            disabled={pending}
            className="w-full rounded border-[1.5px] border-ore bg-ore p-3 text-sm font-bold text-white hover:bg-ore-strong disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
