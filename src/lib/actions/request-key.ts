// 0163 (F-11): one intended action is one command, and the command carries an
// identity so a retry can be recognised as the same intent.
//
// The business fields cannot do this job: two ₦50,000 repayments on the same
// day, two identical diesel expenses and two advances of the same amount to the
// same supplier are all legitimate. Only the command id separates "the user
// meant this twice" from "the browser sent it twice".

/** The form field every idempotent action reads. */
export const REQUEST_KEY_FIELD = "request_key";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the command id a submission carries. Returns null when it is missing or
 * malformed; each action decides what that means for it — the payment RPC
 * refuses outright (ID001), while an insert simply gets a server-stamped key
 * and forfeits replay protection rather than gaining a way round the index.
 */
export function requestKeyFrom(formData: FormData): string | null {
  const raw = String(formData.get(REQUEST_KEY_FIELD) ?? "").trim();
  return UUID.test(raw) ? raw : null;
}

/**
 * A Postgres unique violation. For these tables that means one thing: this
 * command already did its work, so the caller is a retry and the right answer
 * is the success it missed the first time.
 */
export function isReplay(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}
