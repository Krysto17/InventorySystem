// TEMPORARY ROLLOUT BRIDGE — delete with the final T7 commit.
//
// 0162 changes four approval interfaces at once (review_expense, review_advance,
// approve_pricing's signature, approve_cost_price_run). Neither the old app on
// the new database nor the new app on the old database can approve anything, so
// a single-step rollout would break every approval screen in one direction or
// the other. This bridge lets ONE build run correctly against both, which is
// what makes a zero-downtime sequence possible:
//
//     deploy bridge (DB still 0161)  →  apply 0162  →  deploy final T7 app
//
// The fallback condition is deliberately the narrowest one that exists: the
// database has told us the function is not there, which can only mean the
// migration has not been applied yet.
//
//   PGRST202  PostgREST could not find the function in its schema cache.
//   42883     Postgres undefined_function.
//
// Everything else takes the new path's answer unchanged — ST001 (stale review),
// ST002 (approved record frozen), CP001-CP005, 42501 and every other refusal,
// plus transport failures and timeouts, which carry no code at all. A refusal
// must never be retried through the unprotected path: that would turn a stale
// approval into a successful one, which is the whole defect T7 exists to close.
//
// Belt and braces: even if this ever fired against 0162, the old paths are
// refused there anyway — a direct approval UPDATE raises ST001, and
// approve_pricing(uuid) no longer exists. The bridge cannot manufacture an
// unreviewed approval on a migrated database.
export function isMissingFunction(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code;
  return code === "PGRST202" || code === "42883";
}
