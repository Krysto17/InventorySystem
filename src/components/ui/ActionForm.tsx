"use client";

import { useActionState } from "react";
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

  return (
    <form {...props} action={formAction} className={className}>
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
