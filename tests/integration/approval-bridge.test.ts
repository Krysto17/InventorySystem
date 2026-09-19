import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { isMissingFunction } from "@/lib/approvals/bridge";

/**
 * The T7 rollout bridge, and the one thing it must never do.
 *
 * 0162 changes four approval interfaces at once, so neither the old app on the
 * new database nor the new app on the old one can approve anything. The bridge
 * lets a single build serve both, which is what makes the sequence
 *   deploy bridge (DB 0161) → apply 0162 → deploy final app
 * possible without a window where approvals are broken.
 *
 * Its only legitimate fallback is "the function is not there yet". A refusal —
 * above all ST001 — must never be retried down the unprotected path, because
 * that would convert a stale approval into a successful one and undo T7.
 */
describe("stale-approval rollout bridge", () => {
  const src = (p: string) => readFileSync(`src/${p}`, "utf8");
  const appSrc = (p: string) => src(`app/${p}`);
  const bodyOf = (file: string, fn: string) => {
    const s = appSrc(file);
    const at = s.indexOf(`export async function ${fn}(`);
    expect(at, `${fn} must exist`).toBeGreaterThan(-1);
    const next = s.indexOf("\nexport async function ", at + 1);
    return s.slice(at, next === -1 ? undefined : next);
  };

  const ACTIONS: Array<[string, string, string]> = [
    ["(inventory)/inventory/consumables/actions.ts", "reviewExpense", "review_expense"],
    ["(manager)/manager/advances/actions.ts", "setAdvanceApproval", "review_advance"],
    ["visits/[id]/batch-actions.ts", "approvePricing", "approve_pricing"],
    ["(owner)/owner/cost-batches/actions.ts", "approveCostBatch", "approve_cost_price_run"],
  ];

  // ── the fallback condition itself ─────────────────────────────────────────

  it("1. falls back only when the database says the function is absent", () => {
    expect(isMissingFunction({ code: "PGRST202" }), "PostgREST schema-cache miss").toBe(true);
    expect(isMissingFunction({ code: "42883" }), "Postgres undefined_function").toBe(true);
  });

  it("2. never falls back for a refusal, a failure, or a missing code", () => {
    const mustNotFallBack = [
      "ST001", "ST002",                                   // the T7 refusals themselves
      "CP001", "CP002", "CP003", "CP004", "CP005",        // 0160
      "GP007", "SP001", "SF001", "SF004", "RS001", "AD001", "VM002", // earlier tranches
      "42501",                                            // RLS denial
      "23505", "23514", "40P01", "P0001",                 // constraint / deadlock / raise
      "57014", "08006", "ECONNRESET", "ETIMEDOUT",        // cancellation and transport
      "", "PGRST301", "PGRST116",
    ];
    for (const code of mustNotFallBack) {
      expect(isMissingFunction({ code }), `must not fall back on ${code}`).toBe(false);
    }
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
    expect(isMissingFunction({}), "a failure with no code").toBe(false);
    expect(isMissingFunction({ code: null })).toBe(false);
  });

  // ── how the actions use it ────────────────────────────────────────────────

  it("3. every bridged action tries the protected interface first", () => {
    for (const [file, fn, rpc] of ACTIONS) {
      const body = bodyOf(file, fn);
      expect(body, `${fn} must call ${rpc}`).toContain(rpc);
      expect(body, `${fn} must gate its fallback on isMissingFunction`).toContain("isMissingFunction(");
    }
  });

  it("4. no action falls back on a stale or business refusal", () => {
    for (const [file, fn] of ACTIONS) {
      const body = bodyOf(file, fn);
      // The only condition guarding a legacy path is the missing-function one.
      for (const forbidden of [
        'if (error?.code === "ST001") {',
        'if (error?.code !== "ST001")',
        "catch",
      ]) {
        expect(body, `${fn} must not branch to a legacy path on ${forbidden}`).not.toContain(forbidden);
      }
      // ST001 must still be surfaced as the fixed sentence.
      expect(body, `${fn} must surface staleness`).toMatch(/ST001|STALE_MESSAGE/);
    }
  });

  it("5. the bridge is marked temporary so it is removed with the final commit", () => {
    expect(src("lib/approvals/bridge.ts")).toContain("TEMPORARY ROLLOUT BRIDGE");
    for (const [file, fn] of ACTIONS) {
      expect(bodyOf(file, fn), `${fn} marks its bridge`).toContain("ROLLOUT BRIDGE");
    }
  });

  // ── the safety net underneath it ──────────────────────────────────────────
  // Even if the fallback ever fired against 0162, the legacy paths are refused
  // there. This is what makes the bridge safe rather than merely careful.

  describe("against DB 0162 the legacy paths cannot approve anything", () => {
    const stamp = Date.now().toString(36);
    let dong: string, owner: TestUser, inv: TestUser;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      owner = await makeUser({ username: `br-owner-${stamp}`, role: "owner", siteId: null });
      inv = await makeUser({ username: `br-inv-${stamp}`, role: "inventory", siteId: dong });
    });

    it("6. the legacy expense approval UPDATE is refused", async () => {
      const { data } = await adminClient().from("consumables").insert({
        site_id: dong, name: `bridge ${stamp}`, category: "fuel_lubricants",
        amount_naira: 1000, recorded_by: inv.id, approval_status: "pending",
      }).select("id").single();
      const id = (data as { id: string }).id;
      const res = await owner.client.from("consumables")
        .update({ approval_status: "approved" }).eq("id", id).select("id");
      expect(res.error?.code, "the pre-0162 path is closed").toBe("ST001");
      expect((await adminClient().from("consumables").select("approval_status")
        .eq("id", id).single()).data!.approval_status).toBe("pending");
    });

    it("7. the legacy single-argument approve_pricing no longer exists", async () => {
      // Called exactly the way the 0161 app called it. On 0162 the signature is
      // gone, so PostgREST reports it missing. That is why the pricing bridge
      // only probes this path when the page supplied NO token: with a token it
      // always uses approve_pricing(uuid, text), and a missing-token probe that
      // comes back "absent" on 0162 ends in STALE_MESSAGE, never an approval.
      const res = await owner.client.rpc("approve_pricing", { p_visit_id: crypto.randomUUID() } as never);
      expect(res.error, "the versionless signature is gone").not.toBeNull();
      expect(isMissingFunction(res.error), "and it reads as a missing function").toBe(true);
    });

    it("8. the legacy cost-price approval UPDATE is refused", async () => {
      const { data: run } = await inv.client.from("cost_price_runs").insert({
        site_id: dong, label: `bridge run ${stamp}`, approval_status: "pending", created_by: inv.id,
      }).select("id").single();
      const id = (run as { id: string }).id;
      const res = await owner.client.from("cost_price_runs")
        .update({ approval_status: "approved" }).eq("id", id).select("id");
      expect(res.error?.code, "the pre-0162 path is closed").toBe("ST001");
      expect((await adminClient().from("cost_price_runs").select("approval_status")
        .eq("id", id).single()).data!.approval_status).toBe("pending");
    });
  });
});
