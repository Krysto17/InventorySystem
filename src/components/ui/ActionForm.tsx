"use client";

import { useActionState, useRef } from "react";
import { REQUEST_KEY_FIELD } from "@/lib/actions/request-key";
import type { ActionResult } from "@/lib/actions/result";

const INITIAL: ActionResult = { ok: false };

/**
 * A <form> whose server action reports whether the write actually landed.
 *
 * The forms this replaces posted to actions returning Promise<void>, so a write
 * that RLS refused — which comes back as no error and zero rows — revalidated
 * the page and re-rendered the unchanged figures as though it had saved. The
 * money ones mattered most: a deduction that never existed still looked
 * recorded.
 *
 * SubmitButton already covers the pending half through useFormStatus, but a
 * form action has nowhere to put a RESULT. useActionState does, and it needs a
 * client component — hence this wrapper rather than eight near-identical ones.
 * Children are unchanged, so each call site is a tag swap.
 */
export function ActionForm({
  action,
  children,
  className,
  successText,
  ...props
}: Omit<React.ComponentProps<"form">, "action"> & {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  successText?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);

  // 0163: one intended action is one command. The id is minted on the client at
  // submit time (not at render, which would make every form on a page share one
  // id) and kept until that action SUCCEEDS, so a resubmit after a lost or slow
  // response replays the same command instead of creating a second effect. Once
  // it lands, the next submission is a new intent and gets a new id — which is
  // what lets someone legitimately log the same expense twice.
  const commandId = useRef<string | null>(null);

  function submit(formData: FormData) {
    // `state` is the previous submission's result. If that one succeeded, this
    // is a fresh intent and needs its own id — which is what lets someone
    // legitimately log the same expense twice. If it failed, or never came
    // back, this is the same intent again and keeps the same id, so the server
    // recognises it as a replay instead of doing the work twice.
    if (state.ok) commandId.current = null;
    commandId.current ??= crypto.randomUUID();
    formData.set(REQUEST_KEY_FIELD, commandId.current);
    return formAction(formData);
  }

  return (
    <form {...props} action={submit} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="mt-1 w-full text-xs text-red-600">
          {state.error}
        </p>
      )}
      {state.ok && (state.message ?? successText) && (
        <p className="mt-1 w-full text-xs text-emerald-700 dark:text-emerald-500">
          {state.message ?? successText}
        </p>
      )}
    </form>
  );
}
