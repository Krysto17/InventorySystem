import { createHash } from "node:crypto";

// Server-only, and deliberately NOT in request-key.ts: that module is imported
// by the client hook that mints command ids, and `node:crypto` would follow it
// into the browser bundle.

/**
 * A stable command id for one row of a multi-row command.
 *
 * Some single clicks have to write several rows — paying a settlement whose
 * payout was split across three accounts writes three payments. Each row needs
 * its own `request_key`, because 0163 put a unique index on that column, but
 * they cannot be three fresh UUIDs: a retry would then look like three new
 * payments and pay the supplier twice.
 *
 * So each row's key is *derived* from the one command id the form carried plus
 * something stable about the row (the split's own id). The same click always
 * produces the same keys, which is what makes the retry safe: rows that already
 * landed replay and return their original payment, and only the rows that never
 * landed are inserted. A half-finished payout therefore completes correctly on
 * a second click instead of double-paying.
 *
 * Formatted as a v5-shaped UUID so it satisfies the column's type.
 *
 * The seed is length-prefixed rather than simply joined, so that no pair of
 * inputs can ever produce the same seed by moving the separator ("a" + ":b" vs
 * "a:b" + ""). Today both arguments are well-formed — a validated UUID and
 * either a split's id or a fixed literal — so this is belt and braces, but a
 * key collision here would silently skip a payment, which is not a failure to
 * leave to the shape of the caller's strings.
 */
export function derivedRequestKey(commandId: string, discriminator: string): string {
  const seed = `${commandId.length}:${commandId}:${discriminator.length}:${discriminator}`;
  const h = createHash("sha256").update(seed).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
