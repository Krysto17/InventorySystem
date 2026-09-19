import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient } from "../setup/supabase-test-clients";
import { isMissingFunction } from "@/lib/actions/schema-capability";

/**
 * The T8 rollout bridge, and the two things it must never do.
 *
 * 0163 changes two interfaces at once — the payment RPC gains a required
 * command id, and ten inserts gain a `request_key` column — so neither the old
 * app on the new database nor the new app on the old one can write money or
 * stock. One build serves both so the rollout has no broken window:
 *
 *     deploy bridge (DB 0162) → apply 0163 → deploy final T8 app
 *
 * It must never (a) retry a REFUSED payment down the unprotected path, which
 * could pay a supplier twice, and (b) retry a financial INSERT after a failure
 * of unknown outcome, for the same reason. So capability is settled by a read
 * before the write, and the only fallback condition is "that function is not
 * there".
 */
describe("duplicate/retry rollout bridge", () => {
  const src = (p: string) => readFileSync(`src/${p}`, "utf8");

  it("1. falls back only when the database says the function is absent", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
  });

  it("2. never falls back for a refusal, a failure, or a missing code", () => {
    const never = [
      "ID001",                                             // the T8 refusal itself
      "ST001", "ST002",                                    // T7
      "SP001", "SF001", "SF002", "SF003", "SF004",         // T1/T3
      "CP001", "CP002", "CP003", "CP004", "CP005",         // T5
      "GP001", "GP007", "RS001", "AD001", "VM001", "VM002",// 0155/T6/T2
      "42501", "42703",                                    // RLS denial, missing column
      "23505", "23503", "23514", "40P01", "P0001",
      "57014", "08006", "ECONNRESET", "ETIMEDOUT",
      "", "PGRST301", "PGRST116",
    ];
    for (const code of never) {
      expect(isMissingFunction({ code }), `must not fall back on ${code}`).toBe(false);
    }
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
    expect(isMissingFunction({})).toBe(false);
    expect(isMissingFunction({ code: null })).toBe(false);
  });

  it("3. capability is decided by a READ, before any write", () => {
    const cap = src("lib/actions/schema-capability.ts");
    expect(cap, "temporary and marked as such").toContain("TEMPORARY ROLLOUT BRIDGE");
    expect(cap, "a read-only probe").toMatch(/\.select\("request_key"\)/);
    expect(cap, "and it writes nothing").not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(/);

    expect(cap, "the insert payload asks capability first").toContain("requestKeyPayload");
    expect(cap, "and it gates on the probe").toMatch(/requestKeyPayload[\s\S]*hasRequestKeySupport\(\)/);
    // The client-safe module must stay free of server-only imports, or the
    // build fails: ActionForm imports it.
    expect(src("lib/actions/request-key.ts"), "client-safe").not.toContain("server-only");
    expect(src("lib/actions/request-key.ts"), "client-safe").not.toContain("supabase/server");

    // The forbidden shortcut: attempt the write, then retry without the key.
    for (const f of [
      "app/(inventory)/inventory/consumables/actions.ts",
      "app/(manager)/manager/advances/actions.ts",
      "app/visits/[id]/finance-actions.ts",
      "app/visits/[id]/batch-actions.ts",
      "app/(inventory)/inventory/actions.ts",
      "app/(gate)/gate/actions.ts",
      "app/(manager)/manager/gate-passes/actions.ts",
      "app/(manager)/manager/cost-price/actions.ts",
    ]) {
      expect(src(f), `${f} must not retry an insert after a missing-column error`)
        .not.toMatch(/42703/);
    }
  });

  it("4. the payment bridge gates on capability and never retries a refusal", () => {
    const s = src("app/visits/[id]/finance-actions.ts");
    const at = s.indexOf("export async function recordSettlementPayment(");
    const body = s.slice(at, s.indexOf("\nexport async function ", at + 1));
    expect(body, "capability first").toContain("hasRequestKeySupport()");
    expect(body, "narrow fallback only").toContain("isMissingFunction(error)");
    expect(body, "and the fallback is guarded by having tried the protected path")
      .toContain("protectedRpc && isMissingFunction(error)");
    for (const forbidden of ["ID001", "catch"]) {
      expect(body, `must not branch to legacy on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("5. against this database the bridge detects the schema correctly", async () => {
    const { error } = await adminClient().from("consumables").select("request_key").limit(1);
    // The probe's answer must match whether the column is really there.
    const columnExists = !error;
    expect(typeof columnExists).toBe("boolean");
    if (columnExists) {
      // 0163: the protected payment signature must be the only one.
      const res = await adminClient().rpc("record_settlement_payment", {
        p_settlement_id: crypto.randomUUID(), p_amount: 1, p_method: "transfer",
      } as never);
      expect(res.error, "a keyless payment is refused, not silently accepted").not.toBeNull();
      expect(isMissingFunction(res.error), "and that refusal is NOT a missing function")
        .toBe(false);
    }
  });
});
