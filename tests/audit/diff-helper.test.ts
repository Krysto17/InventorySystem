import { describe, it, expect } from "vitest";
import { adminClient } from "../setup/supabase-test-clients";

describe("jsonb_diff_changed", () => {
  async function diff(
    old: object,
    neu: object,
  ): Promise<Record<string, { old: unknown; new: unknown }>> {
    const { data, error } = await adminClient().rpc("jsonb_diff_changed", {
      old: old as object,
      new: neu as object,
    });
    expect(error).toBeNull();
    return data as Record<string, { old: unknown; new: unknown }>;
  }

  it("returns empty object when nothing changed", async () => {
    expect(await diff({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual({});
  });

  it("returns only changed keys", async () => {
    const d = await diff({ a: 1, b: "x", c: true }, { a: 2, b: "x", c: false });
    expect(d).toEqual({
      a: { old: 1, new: 2 },
      c: { old: true, new: false },
    });
  });

  it("captures new keys with old=null", async () => {
    const d = await diff({ a: 1 }, { a: 1, b: 2 });
    expect(d).toEqual({ b: { old: null, new: 2 } });
  });
});
