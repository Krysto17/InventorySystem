import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { fromWrite } from "../../src/lib/actions/result";

/**
 * S-1: a write the database refused must not be reported as success.
 *
 * Twelve server actions that move money or stock returned Promise<void> and
 * dropped the write result — nine on the visit screens (3B-2), then three more
 * on cost-price once 0149 gave inventory a delete path (1a2e47d). That matters
 * here specifically because an RLS-denied write is NOT an error — PostgREST
 * answers `error: null, data: []` — so the action
 * revalidated the page and the unchanged figures re-rendered as though the
 * money had moved. A deduction that never existed looked recorded.
 *
 * Three things have to hold, and they are tested at the level each actually
 * lives at rather than by mocking a server action, which this harness cannot
 * invoke (they reach for next/headers through getProfile()):
 *
 *   1. the database really does answer a denied write with zero rows;
 *   2. fromWrite() calls that a failure;
 *   3. all twelve actions actually route through it.
 */

// `dir` defaults to the visit actions, where this started. The cost-price
// actions live elsewhere and were fixed later (1a2e47d) for the same reason:
// 0149 gave inventory a delete path, and a delete RLS refuses on an approved
// batch returns no error and no rows.
const VISIT_ACTIONS = "visits/[id]";
const ACTIONS: { file: string; fn: string; kind: "table" | "rpc"; dir?: string }[] = [
  { file: "finance-actions.ts", fn: "removePayoutSplit", kind: "table" },
  { file: "finance-actions.ts", fn: "addUtilityCharge", kind: "table" },
  { file: "finance-actions.ts", fn: "adjustUtilityCharge", kind: "table" },
  { file: "finance-actions.ts", fn: "reopenProcessingFee", kind: "rpc" },
  { file: "finance-actions.ts", fn: "recordDeduction", kind: "table" },
  { file: "finance-actions.ts", fn: "removeDeduction", kind: "table" },
  { file: "finance-actions.ts", fn: "removeUtilityCharge", kind: "table" },
  { file: "settlement-actions.ts", fn: "updateSupplierAccount", kind: "table" },
  { file: "settlement-actions.ts", fn: "setSettlementStatus", kind: "table" },
  { file: "actions.ts", fn: "removeRunLot", kind: "table", dir: "(manager)/manager/cost-price" },
  { file: "actions.ts", fn: "removeRunExtra", kind: "table", dir: "(manager)/manager/cost-price" },
  { file: "actions.ts", fn: "deleteCostPriceRun", kind: "table", dir: "(manager)/manager/cost-price" },
];

const source = (file: string, dir = VISIT_ACTIONS) =>
  readFileSync(new URL(`../../src/app/${dir}/${file}`, import.meta.url), "utf8");

/** The body of one exported action, up to the next top-level export. */
function bodyOf(file: string, fn: string, dir?: string): string {
  const s = source(file, dir);
  const start = s.indexOf(`export async function ${fn}(`);
  if (start === -1) throw new Error(`${fn} not found in ${dir ?? VISIT_ACTIONS}/${file}`);
  const next = s.indexOf("\nexport async function ", start + 1);
  return s.slice(start, next === -1 ? undefined : next);
}

describe("silent write failure", () => {
  // ── 2. The helper's contract, stated outright ────────────────────────────
  describe("fromWrite treats a refused write as a failure", () => {
    it("zero rows is a failure, not success", () => {
      expect(fromWrite({ error: null, data: [] }).ok).toBe(false);
    });
    it("null data is a failure", () => {
      expect(fromWrite({ error: null, data: null }).ok).toBe(false);
    });
    it("a database error is a failure, and keeps its message", () => {
      const r = fromWrite({ error: { message: "permission denied" }, data: null });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("permission denied");
    });
    it("a row written is success", () => {
      expect(fromWrite({ error: null, data: [{ id: "x" }] }).ok).toBe(true);
    });
    it("carries an explanation the UI can show", () => {
      expect(fromWrite({ error: null, data: [] }, "Nothing was removed.").error).toBe("Nothing was removed.");
    });
  });

  // ── 1. The database really does answer this way ─────────────────────────
  describe("an RLS-denied write really does come back as zero rows", () => {
    let outsider: TestUser, chargeId: string, visitId: string;

    beforeAll(async () => {
      const { data: sites } = await adminClient().from("sites").select("id, name");
      const site = sites!.find((s) => s.name !== "New-Site")!.id as string;
      const other = sites!.find((s) => s.name === "New-Site")!.id as string;

      // A role with no business touching another site's utility charges.
      outsider = await makeUser({ username: `swf-${Date.now()}`, role: "processing", siteId: other });

      const { data: sup } = await adminClient().from("suppliers")
        .insert({ name: `SWF ${Date.now()}` }).select("id").single();
      const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
      const { data: v } = await adminClient().from("visits").insert({
        site_id: site, supplier_id: sup!.id, declared_material_type_id: mt!.id,
        entry_path: "processed", state: "in_accounting", created_by: outsider.userId,
      }).select("id").single();
      visitId = v!.id as string;

      const { data: c } = await adminClient().from("utility_charges").insert({
        visit_id: visitId, kind: "light_bill", amount: 5000, recorded_by: outsider.userId,
      }).select("id").single();
      chargeId = c!.id as string;
    });

    it("the denied UPDATE reports no error and no rows — the shape that fooled the UI", async () => {
      const res = await outsider.client
        .from("utility_charges").update({ amount: 999999 }).eq("id", chargeId).select("id");
      // This is the whole point: not an error, just nothing.
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      // And the fix reads that correctly.
      expect(fromWrite(res as never).ok).toBe(false);
    });

    it("the row is genuinely untouched, so 'success' would have been a lie", async () => {
      const { data } = await adminClient()
        .from("utility_charges").select("amount").eq("id", chargeId).single();
      expect(Number(data!.amount)).toBe(5000);
    });

    it("the denied DELETE behaves the same way", async () => {
      const res = await outsider.client
        .from("utility_charges").delete().eq("id", chargeId).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { count } = await adminClient()
        .from("utility_charges").select("id", { count: "exact", head: true }).eq("id", chargeId);
      expect(count).toBe(1); // still there
    });
  });

  // ── 3. Every one of them routes through it ───────────────────────────────
  describe("every money- or stock-touching action consumes the safe pattern", () => {
    for (const { file, fn, kind, dir } of ACTIONS) {
      it(`${fn} returns ActionResult and cannot silently succeed`, () => {
        const body = bodyOf(file, fn, dir);
        expect(body, `${fn} must return ActionResult`).toContain("Promise<ActionResult>");
        expect(body, `${fn} must take the useActionState prev arg`).toContain("_prev: ActionResult");
        if (kind === "table") {
          // A table write has to ask for rows back, or zero-row denial is invisible.
          expect(body, `${fn} must .select() so refused rows are visible`).toMatch(/\.select\(/);
          expect(body, `${fn} must interpret the write with fromWrite`).toContain("fromWrite(");
        } else {
          // An RPC raises instead of returning rows.
          expect(body, `${fn} must check the RPC error`).toMatch(/if \(error\) return fail/);
        }
        expect(body, `${fn} must not return bare undefined on a refusal`).not.toMatch(/^\s*return;\s*$/m);
      });
    }

    // C. revalidate must not run as though a failed write had landed.
    for (const { file, fn, dir } of ACTIONS) {
      it(`${fn} does not revalidate before the write is known to have landed`, () => {
        const body = bodyOf(file, fn, dir);
        const revalidate = body.search(/revalidate(Path|SupplierFinance|CostPages)\(/);
        if (revalidate === -1) return; // nothing to order
        const guard = body.search(/if \(!result\.ok\) return result;|if \(error\) return fail/);
        expect(guard, `${fn} must decide the write landed before revalidating`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(revalidate);
      });
    }
  });
});
