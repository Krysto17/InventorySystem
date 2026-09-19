import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requestKeyFrom } from "./request-key";

/**
 * TEMPORARY ROLLOUT BRIDGE — delete with the final T8 commit.
 *
 * 0163 changes two things at once: the payment RPC gains a required command id,
 * and ten inserts gain a `request_key` column. Neither app can serve both
 * databases on its own — the old app's keyless payment is refused by 0163
 * (ID001), and the new app's payloads are rejected by 0162 (no such column, no
 * such parameter). This lets ONE build serve both, so the rollout has no window
 * where money or stock cannot be written:
 *
 *     deploy bridge (DB 0162)  →  apply 0163  →  deploy final T8 app
 *
 * ── Why capability is decided BEFORE the write ─────────────────────────────
 * The obvious shortcut — send the key, and retry without it if the column is
 * missing — is not safe for a financial insert: a request that failed to
 * *answer* may still have committed, and the retry would then double the
 * effect. That is the very defect T8 exists to close, so the bridge asks the
 * schema what it supports first, with a read, and only then performs the write.
 *
 * The probe is a read-only select of one request_key. On 0162 Postgres answers
 * 42703 (undefined_column); on 0163 it succeeds. Nothing is written either way,
 * and the answer is cached for the life of the server process because a
 * migration cannot un-apply itself underneath us.
 */
let cached: boolean | null = null;

export async function hasRequestKeySupport(): Promise<boolean> {
  if (cached !== null) return cached;
  const supabase = await createClient();
  const { error } = await supabase.from("consumables").select("request_key").limit(1);
  // 42703 = undefined_column: the migration is not applied yet.
  // Any other error (RLS, transport) says nothing about the schema, so stay on
  // the compatible path rather than guessing.
  cached = !error;
  return cached;
}

/** Test seam: forget the probe result. */
export function resetSchemaCapability() {
  cached = null;
}

/**
 * The one condition under which the payment call may fall back to the old
 * seven-argument RPC: the database says that function/signature is not there.
 *
 *   PGRST202  PostgREST cannot find the function in its schema cache.
 *   42883     Postgres undefined_function.
 *
 * Never ID001, ST001/ST002, SP001, SF*, CP*, GP*, RS001, AD001, an
 * authorization or validation failure, a constraint violation, a deadlock, a
 * cancellation, a timeout, a transport failure, or an error with no code.
 * Falling back on any of those would retry a refused payment down an
 * unprotected path and could pay a supplier twice.
 */
export function isMissingFunction(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code;
  return code === "PGRST202" || code === "42883";
}

/**
 * TEMPORARY ROLLOUT BRIDGE — delete with the final T8 commit.
 *
 * The command id only goes into the insert when the database has somewhere to
 * put it. The check is a read, made before the write, because retrying a
 * financial insert after a failure of unknown outcome is exactly the double
 * effect T8 exists to prevent.
 */
export async function requestKeyPayload(formData: FormData): Promise<{ request_key?: string }> {
  if (!(await hasRequestKeySupport())) return {};
  const key = requestKeyFrom(formData);
  return key ? { request_key: key } : {};
}
