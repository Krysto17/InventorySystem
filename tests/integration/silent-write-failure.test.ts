import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { fromWrite } from "../../src/lib/actions/result";

/**
 * S-1: a write the database refused must not be reported as success.
 *
 * Twenty-seven server actions that move money or stock returned Promise<void>
 * and dropped the write result — nine on the visit screens (3B-2), three on
 * cost-price once 0149 gave inventory a delete path (1a2e47d), and the fifteen
 * of the visit batch spine (3E-6). That matters
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
 *   3. all twenty-seven actions actually route through it.
 *
 * The batch spine added a third shape. `unsettleLine`, `resettleLine` and
 * `removeLineAsManager` do not write themselves — they hand back whatever the
 * shared `lineAction` helper decides — so they are checked as delegates, and the
 * helper is checked once on its own.
 */

// `dir` defaults to the visit actions, where this started. The cost-price
// actions live elsewhere and were fixed later (1a2e47d) for the same reason:
// 0149 gave inventory a delete path, and a delete RLS refuses on an approved
// batch returns no error and no rows.
const VISIT_ACTIONS = "visits/[id]";
const ACTIONS: { file: string; fn: string; kind: "table" | "rpc" | "delegate"; dir?: string }[] = [
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
  // The visit batch spine (3E-6). recordXrf and submitPricedBatch each pick
  // between an insert and an update, and are "table" because both branches feed
  // one fromWrite — the update is the branch RLS refuses silently.
  { file: "batch-actions.ts", fn: "addMaterialLine", kind: "table" },
  { file: "batch-actions.ts", fn: "updateMaterialLine", kind: "table" },
  { file: "batch-actions.ts", fn: "deleteMaterialLine", kind: "table" },
  { file: "batch-actions.ts", fn: "submitToManager", kind: "rpc" },
  { file: "batch-actions.ts", fn: "skipToPricing", kind: "rpc" },
  { file: "batch-actions.ts", fn: "submitPricedBatch", kind: "table" },
  { file: "batch-actions.ts", fn: "approvePricing", kind: "rpc" },
  { file: "batch-actions.ts", fn: "rejectPricing", kind: "rpc" },
  { file: "batch-actions.ts", fn: "unsettleLine", kind: "delegate" },
  { file: "batch-actions.ts", fn: "resettleLine", kind: "delegate" },
  { file: "batch-actions.ts", fn: "removeLineAsManager", kind: "delegate" },
  { file: "batch-actions.ts", fn: "recordXrf", kind: "table" },
  { file: "batch-actions.ts", fn: "finalizeLinePrice", kind: "table" },
  { file: "batch-actions.ts", fn: "setPriceAgreed", kind: "table" },
  { file: "batch-actions.ts", fn: "setLinePrice", kind: "table" },
];

const source = (file: string, dir = VISIT_ACTIONS) =>
  readFileSync(new URL(`../../src/app/${dir}/${file}`, import.meta.url), "utf8");

/** The body of one exported action, up to the next top-level export. */
function bodyOf(file: string, fn: string, dir?: string): string {
  const s = source(file, dir);
  const start = s.indexOf(`export async function ${fn}(`) >= 0
    ? s.indexOf(`export async function ${fn}(`)
    : s.indexOf(`async function ${fn}(`);
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

  // ── 2b. The batch spine's own lock windows, against the database ─────────
  describe("the visit batch spine's edit locks really do refuse silently", () => {
    let recv: TestUser, qc: TestUser, lineId: string, lateLineId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      const site = sites!.find((s) => s.name === "Dong")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").eq("name", "Monazite").single();
      const stamp = Date.now();
      recv = await makeUser({ username: `swf-recv-${stamp}`, role: "receiving", siteId: site });
      qc = await makeUser({ username: `swf-qc-${stamp}`, role: "qc", siteId: site });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `SWF spine ${stamp}` }).select("id").single();

      // Receiving's lines lock the moment QC starts.
      const { data: v1 } = await admin.from("visits").insert({
        site_id: site, supplier_id: sup!.id, declared_material_type_id: mt!.id,
        entry_path: "processed", state: "in_qc", created_by: recv.userId,
      }).select("id").single();
      const { data: l1 } = await admin.from("visit_materials").insert({
        visit_id: v1!.id, material_type_id: mt!.id, weight_kg: 100, recorded_by: recv.userId,
      }).select("id").single();
      lineId = l1!.id as string;

      // QC's window closes once the batch reaches accounting.
      const { data: v2 } = await admin.from("visits").insert({
        site_id: site, supplier_id: sup!.id, declared_material_type_id: mt!.id,
        entry_path: "processed", state: "in_accounting", created_by: recv.userId,
      }).select("id").single();
      const { data: l2 } = await admin.from("visit_materials").insert({
        visit_id: v2!.id, material_type_id: mt!.id, weight_kg: 50, recorded_by: recv.userId,
      }).select("id").single();
      lateLineId = l2!.id as string;
      await admin.from("xrf_records").insert({
        visit_material_id: lateLineId, result: "SN 60%", submitted: false,
        weight_kg: 50, recorded_by: qc.userId,
      });
    });

    it("updateMaterialLine's write is refused with no error once QC has started", async () => {
      const res = await recv.client.from("visit_materials")
        .update({ weight_kg: 999 }).eq("id", lineId).select("id");
      expect(res.error, "the shape that fooled the UI: no error").toBeNull();
      expect(res.data ?? [], "and no rows").toHaveLength(0);
      expect(fromWrite(res as never).ok, "fromWrite must call that a failure").toBe(false);
      const { data } = await adminClient()
        .from("visit_materials").select("weight_kg").eq("id", lineId).single();
      expect(Number(data!.weight_kg), "the weight is genuinely untouched").toBe(100);
    });

    it("deleteMaterialLine's write is refused with no error once QC has started", async () => {
      const res = await recv.client.from("visit_materials")
        .delete().eq("id", lineId).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
    });

    it("recordXrf's UPDATE branch is refused with no error past the QC window", async () => {
      // The branch that lost a typed-in result: an INSERT here raises, but an
      // UPDATE just matches nothing.
      const res = await qc.client.from("xrf_records")
        .update({ result: "SN 62% (edited)" }).eq("visit_material_id", lateLineId).select("id");
      expect(res.error, "no error — this is why it vanished").toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { data } = await adminClient()
        .from("xrf_records").select("result").eq("visit_material_id", lateLineId).single();
      expect(data!.result, "the analyst's edit never landed").toBe("SN 60%");
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
        } else if (kind === "rpc") {
          // An RPC raises instead of returning rows.
          expect(body, `${fn} must check the RPC error`).toMatch(/if \(error\) return fail/);
        } else {
          // A delegate must hand the helper's verdict back, not swallow it.
          expect(body, `${fn} must return the helper's result`).toMatch(/return lineAction\(/);
          expect(body, `${fn} must not await-and-drop the helper`).not.toMatch(/await lineAction\([^)]*\);\s*\}/);
        }
        expect(body, `${fn} must not return bare undefined on a refusal`).not.toMatch(/^\s*return;\s*$/m);
      });
    }

    it("lineAction itself checks the RPC before reporting success", () => {
      const helper = bodyOf("batch-actions.ts", "lineAction");
      expect(helper, "the shared helper must check the RPC error").toMatch(/if \(error\) return fail/);
      expect(helper, "and must return a result the wrappers can pass on").toContain("Promise<ActionResult>");
    });

    it("submitPricedBatch turns 'no priced lines' into an explicit refusal", () => {
      // A real business refusal that used to be a bare `return;` — the manager
      // pressed submit and nothing whatsoever happened.
      const body = bodyOf("batch-actions.ts", "submitPricedBatch");
      expect(body).toMatch(/if \(!count\) return fail\(/);
    });

    // C. revalidate must not run as though a failed write had landed.
    for (const { file, fn, dir } of ACTIONS) {
      it(`${fn} does not revalidate before the write is known to have landed`, () => {
        const body = bodyOf(file, fn, dir);
        const revalidate = body.search(/revalidate(Path|SupplierFinance|CostPages)\(/);
        if (revalidate === -1) return; // nothing to order
        const guard = body.search(/if \(!\w+\.ok\) return \w+;|if \(error\) return fail|return lineAction\(/);
        expect(guard, `${fn} must decide the write landed before revalidating`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(revalidate);
      });
    }
  });
});
