// A typed result for write actions so failures surface in the UI instead of
// silently no-op'ing (an RLS-filtered update returns no error but 0 rows).
export type ActionResult = { ok: boolean; error?: string; message?: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: string): ActionResult => ({ ok: false, error });

// Interpret a Supabase write that used `.select()` to report affected rows:
// an error, or zero rows (usually RLS denying the row), is a failure.
export function fromWrite(
  res: { error: { message: string } | null; data: unknown[] | null },
  emptyMessage = "Nothing was updated — you may not have permission for this item.",
): ActionResult {
  if (res.error) return fail(res.error.message);
  if (!res.data || res.data.length === 0) return fail(emptyMessage);
  return ok();
}
