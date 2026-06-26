"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself and shows progress while its <form>'s
// server action is in flight. Prevents the double-submit that adds duplicate
// rows when a slow action gives no feedback. Drop-in for <button type="submit">
// inside a server-rendered <form action={serverAction}>.
export function SubmitButton({
  children,
  pendingText,
  className,
  ...props
}: React.ComponentProps<"button"> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...props}
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={className}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
