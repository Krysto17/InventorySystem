import { describe, it, expect } from "vitest";
import { derivedRequestKey } from "@/lib/actions/derived-key";

// Paying a settlement whose payout was split across three accounts writes three
// payment rows from one click. Each row needs its own request_key (0163 put a
// unique index on the column), but they must be REPRODUCIBLE: a retry has to
// recognise the rows that already landed instead of paying the supplier twice.
describe("derivedRequestKey", () => {
  const command = "11111111-2222-3333-4444-555555555555";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("is stable for the same command and row", () => {
    expect(derivedRequestKey(command, "split-a")).toBe(derivedRequestKey(command, "split-a"));
  });

  it("gives each row of one command a different key", () => {
    const keys = ["split-a", "split-b", "split-c", "supplier-balance"]
      .map((d) => derivedRequestKey(command, d));
    expect(new Set(keys).size).toBe(4);
  });

  it("gives different commands different keys for the same row", () => {
    const other = "99999999-8888-7777-6666-555555555555";
    expect(derivedRequestKey(command, "split-a")).not.toBe(derivedRequestKey(other, "split-a"));
  });

  it("produces something the uuid column accepts", () => {
    for (const d of ["split-a", "supplier-balance", ""]) {
      expect(derivedRequestKey(command, d)).toMatch(UUID);
    }
  });

  it("does not collide across a separator boundary", () => {
    // "a" + ":b" and "a:b" + "" must not hash to the same seed.
    expect(derivedRequestKey(command, "a:b")).not.toBe(derivedRequestKey(`${command}:a`, "b"));
  });
});
