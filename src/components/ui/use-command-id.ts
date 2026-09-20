"use client";

import { useRef } from "react";
import { REQUEST_KEY_FIELD } from "@/lib/actions/request-key";
import type { ActionResult } from "@/lib/actions/result";

/**
 * 0163 (F-11): one intended action is one command, and the command carries an
 * id so a retry can be recognised as the same intent rather than a second one.
 *
 * The id is minted on the CLIENT at submit time — not at render, which would
 * make every row on a page share one id — and kept until that action SUCCEEDS.
 * A resubmit after a lost or slow response therefore replays the same command,
 * while the next intent gets a fresh id; that is what lets someone legitimately
 * pay two installments, or log the same expense twice, without either being
 * mistaken for a retry.
 *
 * This lives in a hook rather than inside ActionForm because ActionForm is not
 * the only door: most of the money-moving forms in this app are hand-rolled
 * client components with their own useActionState. Keeping the minting in one
 * place is what stops those doors drifting apart — which is exactly how the
 * payment screens ended up submitting no command id at all.
 */
export function useCommandId(state: ActionResult) {
  const commandId = useRef<string | null>(null);

  /** Wrap a form action so every submission carries the command id. */
  return function withCommandId(
    formAction: (formData: FormData) => void | Promise<void>,
  ) {
    return (formData: FormData) => {
      // `state` is the previous submission's result. If that one succeeded,
      // this is a fresh intent and needs its own id. If it failed, or never
      // came back, this is the same intent again and keeps the same id, so the
      // server recognises it as a replay instead of doing the work twice.
      if (state.ok) commandId.current = null;
      commandId.current ??= crypto.randomUUID();
      formData.set(REQUEST_KEY_FIELD, commandId.current);
      return formAction(formData);
    };
  };
}
