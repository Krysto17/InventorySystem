import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { fromWrite } from "../../src/lib/actions/result";

/**
 * S-1: a write the database refused must not be reported as success.
 *
 * Forty-five server actions that move money, stock or master data returned
 * Promise<void> and dropped the write result — nine on the visit screens
 * (3B-2), three on cost-price once 0149 gave inventory a delete path
 * (1a2e47d), the fifteen of the visit batch spine (3E-6), the seven
 * approval/release actions of 3E-6D (the owner's two cost-batch rulings, the
 * gate's acknowledgement, the advance and expense decisions, the store check,
 * and the supplier account switch), the five money/stock deletes of 3E-6F, the
 * two master-data creates of tranche 2A, the four zero-row updates and deletes
 * of tranche 2B, the three gate/comment inserts of tranche 2C, and issueGatePass
 * (3E-6K) — forty-nine in all. That matters
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
 *   3. all forty-nine actions actually route through it — bar the six
 *      INSERTs, which raise instead of returning zero rows and are checked on
 *      `error`.
 *
 * The 3E-6D seven differ from the earlier tranches in what the operator saw:
 * their callers are server-rendered with no optimistic UI, so a refusal did not
 * fake success — it re-rendered the row untouched. That is still a silent
 * no-op: the owner could not tell "my click missed" from "the system refused",
 * or why. Each of the seven has a genuine refusal below, exercised against the
 * database rather than asserted from source.
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
const ACTIONS: { file: string; fn: string; kind: "table" | "rpc" | "delegate" | "insert"; dir?: string }[] = [
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
  // 3E-6D: the approval / release tier. Each sits at the end of an approval
  // chain, so the refusal it used to swallow is the one that decides whether
  // stock left, money moved, or a payout changed hands.
  { file: "actions.ts", fn: "approveCostBatch", kind: "table", dir: "(owner)/owner/cost-batches" },
  { file: "actions.ts", fn: "rejectCostBatch", kind: "table", dir: "(owner)/owner/cost-batches" },
  { file: "actions.ts", fn: "acknowledgeGatePass", kind: "table", dir: "(gate)/gate" },
  { file: "actions.ts", fn: "setAdvanceApproval", kind: "table", dir: "(manager)/manager/advances" },
  { file: "actions.ts", fn: "reviewExpense", kind: "table", dir: "(inventory)/inventory/consumables" },
  { file: "actions.ts", fn: "confirmLot", kind: "rpc", dir: "stocked-materials" },
  { file: "actions.ts", fn: "switchSupplierAccount", kind: "table", dir: "suppliers" },
  // 3E-6F tranche 1: the money/stock deletes and the sample price. All five
  // fail the same way — RLS filters the row in the USING clause, so the write
  // comes back `error: null, data: []` and the record stays exactly as it was.
  { file: "actions.ts", fn: "deleteAdvance", kind: "table", dir: "(manager)/manager/advances" },
  { file: "actions.ts", fn: "removeAdvanceShare", kind: "table", dir: "(manager)/manager/advances" },
  { file: "actions.ts", fn: "deleteConsumable", kind: "table", dir: "(inventory)/inventory/consumables" },
  { file: "actions.ts", fn: "setSamplePrice", kind: "table", dir: "(qc)/qc/samples" },
  { file: "actions.ts", fn: "deleteSample", kind: "table", dir: "(qc)/qc/samples" },
  // 3E-6F tranche 2A: the master-data creates. These are "insert", NOT "table":
  // an INSERT that RLS refuses RAISES, so there is no zero-row case to detect —
  // and on `machines` a select-back would actively break a working operation
  // (see the GM cross-site test below). `error` is the whole signal.
  { file: "actions.ts", fn: "createMaterialType", kind: "insert", dir: "(owner)/owner/material-types" },
  { file: "actions.ts", fn: "createMachine", kind: "insert", dir: "(owner)/owner/machines" },
  // 3E-6I tranche 2B: the UPDATE/DELETE zero-row group. `.select()` was verified
  // safe for each of these four — unlike createMachine above, where a
  // select-back turns a working INSERT into a 42501 and the row never lands.
  { file: "actions.ts", fn: "clearCheck", kind: "table", dir: "stocked-materials" },
  { file: "gate-exit-actions.ts", fn: "releaseSupplier", kind: "table" },
  { file: "actions.ts", fn: "updateMachine", kind: "table", dir: "(owner)/owner/machines" },
  { file: "actions.ts", fn: "toggleMaterialType", kind: "table", dir: "(owner)/owner/material-types" },
  // 3E-6J tranche 2C: the last three technically actionable H4s, all INSERTs.
  // A refused INSERT raises (42501 / 23505 / 23503), so these are "insert".
  { file: "gate-exit-actions.ts", fn: "authorizeGateExit", kind: "insert" },
  { file: "actions.ts", fn: "recordGateLog", kind: "insert", dir: "(gate)/gate" },
  { file: "settlement-actions.ts", fn: "addBatchComment", kind: "insert" },
  // 3E-6K: the last one. Authorization kept exactly (Option D); only the
  // silence is gone.
  { file: "actions.ts", fn: "issueGatePass", kind: "insert", dir: "(manager)/manager/gate-passes" },
];

const source = (file: string, dir = VISIT_ACTIONS) =>
  readFileSync(new URL(`../../src/app/${dir}/${file}`, import.meta.url), "utf8");

/**
 * The same body with comments removed, for assertions about what the code
 * DOES. An action's slice runs up to the next export, so it carries the
 * explanatory comment written above that next function — and those comments
 * discuss `.select()` and `fromWrite` by name. Matching prose would have
 * reported createMachine as select-backed when it plainly is not.
 */
const codeOf = (file: string, fn: string, dir?: string) =>
  bodyOf(file, fn, dir).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

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

  // ── 2c. The 3E-6D approval tier really is refused, and says so ───────────
  describe("the approval and release tier really does get refused", () => {
    let owner: TestUser, gate: TestUser, mgr: TestUser;
    let site: string, materialTypeId: string, supplierId: string;
    const stamp = Date.now();

    // A lot backed by a matching 'in' movement, so its bucket can cover the
    // 'out' the approval writes. `covered: false` leaves the bucket empty,
    // which is how the 0153 balance guard gets exercised.
    async function lot(kg: number, covered = true) {
      const admin = adminClient();
      if (covered) {
        await admin.from("stock_movements").insert({
          site_id: site, material_type_id: materialTypeId, grade: null,
          weight: kg, direction: "in", reason: "purchase_intake",
        });
      }
      const { data, error } = await admin.from("stock_lots").insert({
        site_id: site, material_type_id: materialTypeId,
        weight_kg: kg, status: "available", cost_price_per_kg: 5,
      }).select("id").single();
      expect(error, `lot fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    }

    async function run(label: string, lots: string[]) {
      const admin = adminClient();
      const { data, error } = await admin.from("cost_price_runs").insert({
        site_id: site, label: `${label} ${stamp}`, material_type_id: materialTypeId,
        approval_status: "pending",
      }).select("id").single();
      expect(error, `run fixture: ${error?.message}`).toBeNull();
      await admin.from("cost_price_run_lots")
        .insert(lots.map((id) => ({ run_id: data!.id as string, stock_lot_id: id })));
      return data!.id as string;
    }

    // Exactly what approveCostBatch / rejectCostBatch send.
    const rule = (runId: string, decision: "approved" | "rejected") =>
      owner.client.from("cost_price_runs")
        .update({ approval_status: decision, approved_by: owner.userId, approved_at: new Date().toISOString() })
        .eq("id", runId).eq("approval_status", "pending").select("id");

    const statusOfRun = async (id: string) => {
      const { data } = await adminClient()
        .from("cost_price_runs").select("approval_status").eq("id", id).single();
      return data!.approval_status as string;
    };

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      site = sites!.find((s) => s.name === "Dong")!.id as string;
      // Its own material type, so this suite's buckets are nobody else's.
      const { data: mt } = await admin.from("material_types")
        .insert({ name: `Tier1 ${stamp}` }).select("id").single();
      materialTypeId = mt!.id as string;
      owner = await makeUser({ username: `t1-owner-${stamp}`, role: "owner", siteId: null });
      gate = await makeUser({ username: `t1-gate-${stamp}`, role: "gate", siteId: site });
      mgr = await makeUser({ username: `t1-mgr-${stamp}`, role: "manager", siteId: site });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `Tier1 ${stamp}` }).select("id").single();
      supplierId = sup!.id as string;
    });

    // ── approveCostBatch ──────────────────────────────────────────────────
    it("approveCostBatch: a batch already ruled on matches no rows", async () => {
      const runId = await run("already ruled", [await lot(10)]);
      expect((await rule(runId, "approved")).data ?? [], "the first approval lands").toHaveLength(1);

      const res = await rule(runId, "approved");
      expect(res.error, "the shape that fooled the UI: no error").toBeNull();
      expect(res.data ?? [], "and no rows — nothing was approved twice").toHaveLength(0);
      expect(fromWrite(res as never).ok, "which fromWrite must call a failure").toBe(false);
      expect(fromWrite(res as never).error, "and must explain").toBeTruthy();
    });

    it("approveCostBatch: a lot that already left stock raises, and nothing sells", async () => {
      // Since 0160 a pending run reserves its lots, so the lot leaves stock the
      // other real way while the batch waits: the gate releases it.
      const L = await lot(20);
      const pending = await run("stale claim", [L]);
      const passId = await pass("issued", L, 20);
      expect((await ack(passId)).error, "the release goes through").toBeNull();

      const res = await rule(pending, "approved");
      expect(res.error, "the approval must be refused").not.toBeNull();
      expect(res.error!.code).toBe("CP002");
      expect(fromWrite(res as never).ok).toBe(false);
      expect(await statusOfRun(pending), "and the batch stays pending").toBe("pending");
    });

    // ── rejectCostBatch ───────────────────────────────────────────────────
    it("rejectCostBatch: a batch already ruled on matches no rows", async () => {
      const runId = await run("reject twice", [await lot(5)]);
      expect((await rule(runId, "rejected")).data ?? []).toHaveLength(1);

      const res = await rule(runId, "rejected");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      expect(await statusOfRun(runId), "it stays rejected, not re-ruled").toBe("rejected");
    });

    // ── acknowledgeGatePass ───────────────────────────────────────────────
    async function pass(status: string, stockLotId: string | null, kg: number | null) {
      const { data, error } = await adminClient().from("gate_passes").insert({
        site_id: site, material_type_id: materialTypeId,
        material_owner: `Tier1 ${stamp}-${Math.random()}`, reason: "out of spec",
        status, issued_by: mgr.userId, stock_lot_id: stockLotId, weight_kg: kg,
      }).select("id").single();
      expect(error, `pass fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    }
    const ack = (id: string) => gate.client.from("gate_passes")
      .update({ status: "acknowledged" }).eq("id", id).select("id");
    const statusOfPass = async (id: string) => {
      const { data } = await adminClient().from("gate_passes").select("status").eq("id", id).single();
      return data!.status as string;
    };

    it("acknowledgeGatePass: a release the store cannot cover is refused", async () => {
      // A lot with no 'in' behind it: the 0153 balance guard sees an empty
      // bucket and refuses the 'out' the acknowledgement would write.
      const id = await pass("issued", await lot(30, false), 30);
      const res = await ack(id);
      expect(res.error, "the gate must not be told the material may leave").not.toBeNull();
      expect(res.error!.message).toMatch(/insufficient stock/i);
      expect(await statusOfPass(id), "the pass stays issued").toBe("issued");
    });

    it("acknowledgeGatePass: an illegal transition is refused", async () => {
      // pending is a manager's to authorise; the gate cannot jump the queue.
      const id = await pass("pending", null, null);
      const res = await ack(id);
      expect(res.error).not.toBeNull();
      expect(res.error!.message).toMatch(/illegal gate pass transition/i);
      expect(await statusOfPass(id)).toBe("pending");
    });

    // ── setAdvanceApproval ────────────────────────────────────────────────
    it("setAdvanceApproval: a paid advance can no longer be ruled on", async () => {
      const { data: a, error } = await adminClient().from("advances").insert({
        supplier_id: supplierId, site_id: site, purpose: `paid ${stamp}`,
        amount_naira: 25000, recorded_by: mgr.userId, approval_status: "paid",
      }).select("id").single();
      expect(error, `advance fixture: ${error?.message}`).toBeNull();

      const res = await owner.client.from("advances")
        .update({ approval_status: "approved" }).eq("id", a!.id as string).select("id");
      expect(res.error, "the owner must be told, not shown an unchanged row").not.toBeNull();
      expect(res.error!.message).toMatch(/paid advance can no longer be modified/i);
      const { data: after } = await adminClient()
        .from("advances").select("approval_status").eq("id", a!.id as string).single();
      expect(after!.approval_status, "and the debt is untouched").toBe("paid");
    });

    // ── reviewExpense ─────────────────────────────────────────────────────
    it("reviewExpense: a paid expense can no longer be ruled on", async () => {
      const { data: c, error } = await adminClient().from("consumables").insert({
        site_id: site, name: `paid expense ${stamp}`, category: "fuel_lubricants",
        amount_naira: 8000, recorded_by: mgr.userId, approval_status: "paid",
      }).select("id").single();
      expect(error, `expense fixture: ${error?.message}`).toBeNull();

      const res = await owner.client.from("consumables")
        .update({ approval_status: "approved" }).eq("id", c!.id as string).select("id");
      expect(res.error).not.toBeNull();
      expect(res.error!.message).toMatch(/paid expense can no longer be modified/i);
      const { data: after } = await adminClient()
        .from("consumables").select("approval_status").eq("id", c!.id as string).single();
      expect(after!.approval_status).toBe("paid");
    });

    // ── confirmLot ────────────────────────────────────────────────────────
    it("confirmLot: record_stock_check's refusal reaches the caller", async () => {
      const lotId = await lot(12);
      await adminClient().from("stock_lots").update({ status: "sold" }).eq("id", lotId);

      const { error } = await mgr.client.rpc("record_stock_check", {
        p_lot_id: lotId, p_status: "confirmed", p_counted_weight: 12, p_note: undefined,
      } as never);
      expect(error, "the RPC raises — dropping it is what hid the refusal").not.toBeNull();
      expect(error!.message).toMatch(/not in stock/i);
      const { count } = await adminClient().from("stock_confirmations")
        .select("stock_lot_id", { count: "exact", head: true }).eq("stock_lot_id", lotId);
      expect(count, "and no count was filed").toBe(0);
    });

    // ── switchSupplierAccount ─────────────────────────────────────────────
    it("switchSupplierAccount: an incomplete former account is refused", async () => {
      const admin = adminClient();
      // A historic account with a number but no name or bank — the shape the
      // account trio rejects. Real history predates the trio rule.
      const { data: s, error } = await admin.from("suppliers").insert({
        name: `Tier1 switch ${stamp}`,
        account_name: "Current Holder", account_number: "0123456789", bank_name: "Zenith",
        former_accounts: [{ account_name: null, account_number: "9876543210", bank_name: null }],
      }).select("id").single();
      expect(error, `supplier fixture: ${error?.message}`).toBeNull();
      const id = s!.id as string;

      // Exactly what switchSupplierAccount writes for that former entry.
      const res = await mgr.client.from("suppliers").update({
        account_name: null, account_number: "9876543210", bank_name: null,
      }).eq("id", id).select("id");
      expect(res.error, "the switch must not look like it happened").not.toBeNull();
      expect(res.error!.message).toMatch(/provided together/i);
      expect(fromWrite(res as never).ok).toBe(false);
      const { data: after } = await admin.from("suppliers")
        .select("account_number").eq("id", id).single();
      expect(after!.account_number, "payouts still go to the account on file").toBe("0123456789");
      await admin.from("suppliers").delete().eq("id", id);
    });
  });

  // ── 2d. The 3E-6F money/stock tranche really is refused ──────────────────
  describe("the money and stock deletes really do get refused", () => {
    let owner: TestUser, mgrDong: TestUser, mgrOld: TestUser, qcA: TestUser, qcB: TestUser;
    let dong: string, oldSite: string, supplierId: string, materialTypeId: string;
    const stamp = Date.now();

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      oldSite = sites!.find((s) => s.name === "Old-Site")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      materialTypeId = mt!.id as string;
      owner = await makeUser({ username: `t2-owner-${stamp}`, role: "owner", siteId: null });
      mgrDong = await makeUser({ username: `t2-mgr-d-${stamp}`, role: "manager", siteId: dong });
      mgrOld = await makeUser({ username: `t2-mgr-o-${stamp}`, role: "manager", siteId: oldSite });
      qcA = await makeUser({ username: `t2-qc-a-${stamp}`, role: "qc", siteId: dong });
      qcB = await makeUser({ username: `t2-qc-b-${stamp}`, role: "qc", siteId: dong });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `Tranche1 ${stamp}` }).select("id").single();
      supplierId = sup!.id as string;
    });

    const advance = async (status: string, site = dong) => {
      const { data, error } = await adminClient().from("advances").insert({
        supplier_id: supplierId, site_id: site, purpose: `t1 ${stamp}-${Math.random()}`,
        amount_naira: 40000, recorded_by: mgrDong.userId, approval_status: status,
      }).select("id").single();
      expect(error, `advance fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    };

    // ── deleteAdvance ─────────────────────────────────────────────────────
    it("deleteAdvance: a paid advance is refused, and the debt survives", async () => {
      const id = await advance("paid");
      const res = await mgrDong.client.from("advances").delete().eq("id", id).select("id");
      expect(res.error, "the shape that fooled the UI: no error").toBeNull();
      expect(res.data ?? [], "and no rows").toHaveLength(0);
      expect(fromWrite(res as never).ok, "fromWrite must call that a failure").toBe(false);
      expect(fromWrite(res as never).error, "and must explain").toBeTruthy();
      const { count } = await adminClient()
        .from("advances").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count, "the advance is genuinely still there").toBe(1);
    });

    it("deleteAdvance: another site's advance is refused the same silent way", async () => {
      const id = await advance("pending", dong);
      const res = await mgrOld.client.from("advances").delete().eq("id", id).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { count } = await adminClient()
        .from("advances").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count).toBe(1);
    });

    // ── removeAdvanceShare ────────────────────────────────────────────────
    it("removeAdvanceShare: a cross-site manager cannot remove the share, silently", async () => {
      const advId = await advance("pending", dong);
      const { data: member } = await adminClient().from("suppliers")
        .insert({ name: `Tranche1 member ${stamp}` }).select("id").single();
      const { data: share, error } = await adminClient().from("advance_shares").insert({
        advance_id: advId, supplier_id: member!.id as string, amount: 1000, created_by: mgrDong.userId,
      }).select("id").single();
      expect(error, `share fixture: ${error?.message}`).toBeNull();

      // Old-Site manager: the advance is Dong's, so RLS matches nothing.
      const res = await mgrOld.client.from("advance_shares")
        .delete().eq("id", share!.id as string).select("id");
      expect(res.error, "no error — this is why it vanished").toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { data: after } = await adminClient().from("advance_shares")
        .select("amount").eq("id", share!.id as string).single();
      expect(Number(after!.amount), "the member still carries the debt").toBe(1000);
    });

    // ── deleteConsumable ──────────────────────────────────────────────────
    it("deleteConsumable: a paid expense is refused, and it stays payable", async () => {
      const { data: c, error } = await adminClient().from("consumables").insert({
        site_id: dong, name: `t1 paid ${stamp}`, category: "fuel_lubricants",
        amount_naira: 12000, recorded_by: mgrDong.userId, approval_status: "paid",
      }).select("id").single();
      expect(error, `expense fixture: ${error?.message}`).toBeNull();

      const res = await mgrDong.client.from("consumables")
        .delete().eq("id", c!.id as string).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { count } = await adminClient()
        .from("consumables").select("id", { count: "exact", head: true }).eq("id", c!.id as string);
      expect(count, "the expense is genuinely still there").toBe(1);
    });

    // ── setSamplePrice / deleteSample ─────────────────────────────────────
    const sample = async (recordedBy: string, price: number | null = null) => {
      const { data, error } = await adminClient().from("sample_analyses").insert({
        site_id: dong, supplier_name: `t1 ${stamp}-${Math.random()}`, result: "SN 4%",
        recorded_by: recordedBy, price,
      }).select("id").single();
      expect(error, `sample fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    };

    it("setSamplePrice: a site manager is refused, and the sample stays unpriced", async () => {
      // Only the owner and the GENERAL manager may price. /manager/samples
      // shows the box to every manager, so this is the reachable refusal.
      const id = await sample(qcA.userId);
      const res = await mgrDong.client.from("sample_analyses")
        .update({ price: 5000, priced_by: mgrDong.userId }).eq("id", id).select("id");
      expect(res.error, "no error — the typed price simply vanished").toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { data: after } = await adminClient()
        .from("sample_analyses").select("price").eq("id", id).single();
      expect(after!.price, "the sample is genuinely still unpriced").toBeNull();
    });

    it("setSamplePrice: the owner's pricing still lands — the success path is unchanged", async () => {
      const id = await sample(qcA.userId);
      const res = await owner.client.from("sample_analyses")
        .update({ price: 7500, priced_by: owner.userId }).eq("id", id).select("id");
      expect(res.error, `owner pricing: ${res.error?.message}`).toBeNull();
      expect(res.data ?? [], "the owner must still be able to price").toHaveLength(1);
      expect(fromWrite(res as never).ok).toBe(true);
    });

    it("deleteSample: an analyst cannot delete a colleague's sample, silently", async () => {
      // The QC screen lists every analyst's samples and offers Delete on any
      // unpriced row; RLS only allows an analyst to remove their own.
      const id = await sample(qcA.userId);
      const res = await qcB.client.from("sample_analyses").delete().eq("id", id).select("id");
      expect(res.error, "no error — the row just stayed put").toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { count } = await adminClient()
        .from("sample_analyses").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count, "the sample is genuinely still there").toBe(1);
    });

    it("deleteSample: even its own author is refused once it is priced", async () => {
      const id = await sample(qcA.userId, 900);
      const res = await qcA.client.from("sample_analyses").delete().eq("id", id).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      const { count } = await adminClient()
        .from("sample_analyses").select("id", { count: "exact", head: true }).eq("id", id);
      expect(count).toBe(1);
    });

    it("deleteSample: an analyst's own unpriced sample still deletes — success unchanged", async () => {
      const id = await sample(qcA.userId);
      const res = await qcA.client.from("sample_analyses").delete().eq("id", id).select("id");
      expect(res.error, `own delete: ${res.error?.message}`).toBeNull();
      expect(res.data ?? [], "the allowed delete must still work").toHaveLength(1);
      expect(fromWrite(res as never).ok).toBe(true);
    });
  });

  // ── 2e. The 3E-6F tranche 2A master-data creates ─────────────────────────
  describe("the master-data creates really do get refused", () => {
    let gm: TestUser, owner: TestUser;
    let dong: string, newSite: string;
    const stamp = Date.now();
    const made: { materials: string[]; machines: string[] } = { materials: [], machines: [] };

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
      // The general manager IS the New-Site manager — that is what
      // is_general_manager() resolves to, and /owner/machines admits them.
      gm = await makeUser({ username: `t2a-gm-${stamp}`, role: "manager", siteId: newSite });
      owner = await makeUser({ username: `t2a-own-${stamp}`, role: "owner", siteId: null });
    });

    afterAll(async () => {
      const admin = adminClient();
      if (made.machines.length) await admin.from("machines").delete().in("name", made.machines);
      if (made.materials.length) await admin.from("material_types").delete().in("name", made.materials);
    });

    // ── createMaterialType ────────────────────────────────────────────────
    it("createMaterialType: a duplicate name is refused, and adds nothing", async () => {
      const name = `T2A Material ${stamp}`;
      made.materials.push(name);
      const first = await owner.client.from("material_types").insert({ name, created_by: owner.userId });
      expect(first.error, `first insert: ${first.error?.message}`).toBeNull();

      const second = await owner.client.from("material_types").insert({ name, created_by: owner.userId });
      expect(second.error, "the duplicate must be refused, not swallowed").not.toBeNull();
      expect(second.error!.code, "a unique-violation").toBe("23505");
      const { count } = await adminClient()
        .from("material_types").select("id", { count: "exact", head: true }).eq("name", name);
      expect(count, "exactly one material type survives").toBe(1);
    });

    // ── createMachine ─────────────────────────────────────────────────────
    it("createMachine: a duplicate (site, name) is refused, and adds nothing", async () => {
      const name = `T2A Machine ${stamp}`;
      made.machines.push(name);
      const row = { site_id: newSite, name, charge_basis: "weight", rate: 12, created_by: gm.userId };
      const first = await gm.client.from("machines").insert(row);
      expect(first.error, `first insert: ${first.error?.message}`).toBeNull();

      const second = await gm.client.from("machines").insert(row);
      expect(second.error, "the duplicate must be refused").not.toBeNull();
      expect(second.error!.code).toBe("23505");
      const { count } = await adminClient()
        .from("machines").select("id", { count: "exact", head: true }).eq("name", name);
      expect(count, "exactly one machine survives").toBe(1);
    });

    // ── The reason createMachine must never gain a .select() ──────────────
    it("createMachine: the GM can still create a machine for ANOTHER site", async () => {
      // `machines: gm inserts` lets the general manager insert for any site, and
      // the form's site selector offers all of them — so this is a real, working
      // operation that must survive the H4 fix.
      const name = `T2A Cross-site ${stamp}`;
      made.machines.push(name);
      const res = await gm.client.from("machines").insert({
        site_id: dong, name, charge_basis: "weight", rate: 9, created_by: gm.userId,
      });
      expect(res.error, `GM cross-site create must succeed: ${res.error?.message}`).toBeNull();
      const { count } = await adminClient()
        .from("machines").select("id", { count: "exact", head: true }).eq("name", name);
      expect(count, "and the machine must genuinely persist").toBe(1);
    });

    it("createMachine: a select-back would break that create — why .select() is banned", async () => {
      // `machines: read own site` is (site_id = current_site() OR is_owner()) —
      // no general-manager clause. So INSERT ... RETURNING cannot read the new
      // cross-site row back, and the WHOLE statement aborts: the machine is not
      // created at all. This pins the hazard, so that if anyone ever
      // "standardises" createMachine onto .select() + fromWrite, or widens the
      // read policy, this test forces the change to be looked at deliberately.
      const name = `T2A Selectback ${stamp}`;
      made.machines.push(name);
      const res = await gm.client.from("machines").insert({
        site_id: dong, name, charge_basis: "weight", rate: 9, created_by: gm.userId,
      }).select("id");
      expect(res.error, "the select-back is refused").not.toBeNull();
      expect(res.error!.code).toBe("42501");
      const { count } = await adminClient()
        .from("machines").select("id", { count: "exact", head: true }).eq("name", name);
      expect(count, "and nothing is written — the row never lands").toBe(0);
    });
  });

  // ── 2f. The 3E-6I tranche 2B zero-row group ──────────────────────────────
  describe("the zero-row update and delete group really does get refused", () => {
    let gm: TestUser, mgrDong: TestUser, gateDong: TestUser;
    let dong: string, newSite: string, materialTypeId: string, supplierId: string;
    const stamp = Date.now();
    const madeMachines: string[] = [];

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      materialTypeId = mt!.id as string;
      // The general manager is the New-Site manager, and reads every site.
      gm = await makeUser({ username: `t2b-gm-${stamp}`, role: "manager", siteId: newSite });
      mgrDong = await makeUser({ username: `t2b-mgr-${stamp}`, role: "manager", siteId: dong });
      gateDong = await makeUser({ username: `t2b-gate-${stamp}`, role: "gate", siteId: dong });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `T2B ${stamp}` }).select("id").single();
      supplierId = sup!.id as string;
    });

    afterAll(async () => {
      if (madeMachines.length) await adminClient().from("machines").delete().in("name", madeMachines);
    });

    // ── clearCheck ────────────────────────────────────────────────────────
    async function checkedLot(site: string) {
      const admin = adminClient();
      const { data: lot } = await admin.from("stock_lots").insert({
        site_id: site, material_type_id: materialTypeId, weight_kg: 7, status: "available",
      }).select("id").single();
      const { error } = await admin.from("stock_confirmations").insert({
        stock_lot_id: lot!.id as string, site_id: site, status: "confirmed", checked_by: mgrDong.userId,
      });
      expect(error, `confirmation fixture: ${error?.message}`).toBeNull();
      return lot!.id as string;
    }
    const stillChecked = async (lotId: string) => {
      const { count } = await adminClient().from("stock_confirmations")
        .select("stock_lot_id", { count: "exact", head: true }).eq("stock_lot_id", lotId);
      return count === 1;
    };

    it("clearCheck: the GM cannot undo another store's check, silently", async () => {
      const lotId = await checkedLot(dong);
      // The GM reads every store, so the Undo button is offered to them.
      expect(
        ((await gm.client.from("stock_lots").select("id").eq("id", lotId)).data ?? []).length,
        "the GM can see the lot — which is why the button appears",
      ).toBe(1);

      const res = await gm.client.from("stock_confirmations")
        .delete().eq("stock_lot_id", lotId).select("stock_lot_id");
      expect(res.error, "the shape that fooled the UI: no error").toBeNull();
      expect(res.data ?? [], "and no rows").toHaveLength(0);
      expect(fromWrite(res as never).ok, "fromWrite must call that a failure").toBe(false);
      expect(await stillChecked(lotId), "the check genuinely still stands").toBe(true);
    });

    it("clearCheck: the own-site manager still clears their own check", async () => {
      const lotId = await checkedLot(dong);
      const res = await mgrDong.client.from("stock_confirmations")
        .delete().eq("stock_lot_id", lotId).select("stock_lot_id");
      expect(res.error, `own-site clear: ${res.error?.message}`).toBeNull();
      expect(res.data ?? [], "the allowed delete must still work").toHaveLength(1);
      expect(fromWrite(res as never).ok).toBe(true);
      expect(await stillChecked(lotId), "and the check is genuinely gone").toBe(false);
    });

    // ── releaseSupplier ───────────────────────────────────────────────────
    async function parkedVisit() {
      const { data, error } = await adminClient().from("visits").insert({
        site_id: dong, supplier_id: supplierId, declared_material_type_id: materialTypeId,
        entry_path: "processed", state: "awaiting_gate_exit", created_by: mgrDong.userId,
      }).select("id").single();
      expect(error, `visit fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    }
    const stateOf = async (id: string) => {
      const { data } = await adminClient().from("visits").select("state").eq("id", id).single();
      return data!.state as string;
    };

    it("releaseSupplier: a release with no gate-exit authorisation is refused", async () => {
      const visitId = await parkedVisit();
      const res = await gateDong.client.from("visits")
        .update({ state: "exited" }).eq("id", visitId).select("id");
      expect(res.error, "the gate must not be told the supplier may leave").not.toBeNull();
      expect(res.error!.message).toMatch(/without a gate exit authorization/i);
      expect(fromWrite(res as never).ok).toBe(false);
      expect(await stateOf(visitId), "the visit stays parked").toBe("awaiting_gate_exit");
    });

    it("releaseSupplier: an authorised release still lands", async () => {
      const visitId = await parkedVisit();
      await adminClient().from("gate_exit_authorizations")
        .insert({ visit_id: visitId, authorized_by: mgrDong.userId });
      const res = await gateDong.client.from("visits")
        .update({ state: "exited" }).eq("id", visitId).select("id");
      expect(res.error, `authorised release: ${res.error?.message}`).toBeNull();
      expect(res.data ?? [], "the legitimate release must still work").toHaveLength(1);
      expect(await stateOf(visitId)).toBe("exited");
    });

    // ── updateMachine ─────────────────────────────────────────────────────
    async function machine(site: string, label: string) {
      const name = `T2B ${label} ${stamp}`;
      madeMachines.push(name);
      const { data, error } = await adminClient().from("machines").insert({
        site_id: site, name, charge_basis: "weight", rate: 10, active: true,
      }).select("id").single();
      expect(error, `machine fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    }
    const activeOf = async (id: string) => {
      const { data } = await adminClient().from("machines").select("active").eq("id", id).single();
      return data!.active as boolean;
    };

    it("updateMachine: a machine outside the caller's reach matches no rows", async () => {
      const id = await machine(dong, "OutOfReach");
      const res = await gm.client.from("machines")
        .update({ active: false }).eq("id", id).select("id");
      expect(res.error).toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
      expect(await activeOf(id), "and the machine is genuinely untouched").toBe(true);
    });

    it("updateMachine: the GM's own-site toggle still works — .select() is safe here", async () => {
      // The distinction from createMachine: for an UPDATE the select-back only
      // reveals the zero-row, it never prevents a write that would have landed.
      const id = await machine(newSite, "OwnSite");
      const res = await gm.client.from("machines")
        .update({ active: false }).eq("id", id).select("id");
      expect(res.error, `own-site toggle: ${res.error?.message}`).toBeNull();
      expect(res.data ?? [], "the legitimate toggle must still work").toHaveLength(1);
      expect(await activeOf(id)).toBe(false);
    });

    it("updateMachine: a blank id is rejected before it reaches Postgres as a bad uuid", () => {
      // Guarded in the action, so 22P02 can no longer be raised and swallowed.
      const body = bodyOf("actions.ts", "updateMachine", "(owner)/owner/machines");
      expect(body, "must refuse a missing id itself").toMatch(/if \(!id\) return fail\(/);
    });

    // ── toggleMaterialType ────────────────────────────────────────────────
    it("toggleMaterialType: a row that no longer exists matches nothing", async () => {
      const res = await gm.client.from("material_types")
        .update({ active: false }).eq("id", "00000000-0000-0000-0000-000000000000").select("id");
      expect(res.error, "no error — just nothing").toBeNull();
      expect(res.data ?? []).toHaveLength(0);
      expect(fromWrite(res as never).ok).toBe(false);
    });

    it("toggleMaterialType: a real material still toggles", async () => {
      const { data: mt } = await adminClient().from("material_types")
        .insert({ name: `T2B mat ${stamp}`, active: true }).select("id").single();
      const id = mt!.id as string;
      const res = await gm.client.from("material_types")
        .update({ active: false }).eq("id", id).select("id");
      expect(res.error, `toggle: ${res.error?.message}`).toBeNull();
      expect(res.data ?? []).toHaveLength(1);
      await adminClient().from("material_types").delete().eq("id", id);
    });
  });

  // ── 2g. The 3E-6J tranche 2C inserts ─────────────────────────────────────
  describe("the tranche 2C inserts raise their refusals instead of hiding them", () => {
    let mgrDong: TestUser, mgrOld: TestUser, gateDong: TestUser;
    let dong: string, oldSite: string, materialTypeId: string, supplierId: string;
    const stamp = Date.now();

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      oldSite = sites!.find((s) => s.name === "Old-Site")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      materialTypeId = mt!.id as string;
      // Plain site managers — the general manager is the New-Site one.
      mgrDong = await makeUser({ username: `t2c-mgr-d-${stamp}`, role: "manager", siteId: dong });
      mgrOld = await makeUser({ username: `t2c-mgr-o-${stamp}`, role: "manager", siteId: oldSite });
      gateDong = await makeUser({ username: `t2c-gate-${stamp}`, role: "gate", siteId: dong });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `T2C ${stamp}` }).select("id").single();
      supplierId = sup!.id as string;
    });

    async function parkedVisit() {
      const { data, error } = await adminClient().from("visits").insert({
        site_id: dong, supplier_id: supplierId, declared_material_type_id: materialTypeId,
        entry_path: "processed", state: "awaiting_gate_exit", created_by: mgrDong.userId,
      }).select("id").single();
      expect(error, `visit fixture: ${error?.message}`).toBeNull();
      return data!.id as string;
    }
    const countWhere = async (table: string, col: string, val: string) => {
      const { count } = await adminClient().from(table)
        .select("id", { count: "exact", head: true }).eq(col, val);
      return count ?? 0;
    };

    // ── authorizeGateExit ─────────────────────────────────────────────────
    it("authorizeGateExit: the first authorisation lands", async () => {
      const visitId = await parkedVisit();
      const res = await mgrDong.client.from("gate_exit_authorizations")
        .insert({ visit_id: visitId, authorized_by: mgrDong.userId, note: "t2c" });
      expect(res.error, `authorise: ${res.error?.message}`).toBeNull();
      expect(await countWhere("gate_exit_authorizations", "visit_id", visitId)).toBe(1);
    });

    it("authorizeGateExit: a second authorisation raises 23505 and writes nothing", async () => {
      // The double click. UNIQUE (visit_id) means the exit already stands, which
      // is why the action reports "already authorised" rather than a failure.
      const visitId = await parkedVisit();
      await mgrDong.client.from("gate_exit_authorizations")
        .insert({ visit_id: visitId, authorized_by: mgrDong.userId });
      const dup = await mgrDong.client.from("gate_exit_authorizations")
        .insert({ visit_id: visitId, authorized_by: mgrDong.userId });
      expect(dup.error, "the duplicate is raised, not swallowed").not.toBeNull();
      expect(dup.error!.code).toBe("23505");
      expect(await countWhere("gate_exit_authorizations", "visit_id", visitId), "still exactly one").toBe(1);
      const { count } = await adminClient().from("transaction_events")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", visitId).eq("event_type", "gate_exit_authorized");
      expect(count, "exactly one audit event — the refused insert fired no trigger").toBe(1);
    });

    it("authorizeGateExit: another site's manager is refused by a raise, not zero rows", async () => {
      const visitId = await parkedVisit();
      const res = await mgrOld.client.from("gate_exit_authorizations")
        .insert({ visit_id: visitId, authorized_by: mgrOld.userId });
      expect(res.error, "an INSERT that RLS refuses raises").not.toBeNull();
      expect(res.error!.code).toBe("42501");
      expect(await countWhere("gate_exit_authorizations", "visit_id", visitId)).toBe(0);
    });

    // ── recordGateLog ─────────────────────────────────────────────────────
    it("recordGateLog: a log against another site's gate raises 42501 and writes nothing", async () => {
      const marker = `T2C wrong site ${stamp}`;
      const res = await gateDong.client.from("gate_logs").insert({
        site_id: oldSite, direction: "in", material_owner: marker, recorded_by: gateDong.userId,
      });
      expect(res.error).not.toBeNull();
      expect(res.error!.code).toBe("42501");
      expect(await countWhere("gate_logs", "material_owner", marker)).toBe(0);
    });

    it("recordGateLog: the gate's own-site log still lands, exactly once", async () => {
      const marker = `T2C own site ${stamp}`;
      const res = await gateDong.client.from("gate_logs").insert({
        site_id: dong, direction: "in", bags: 3, material_owner: marker, recorded_by: gateDong.userId,
      });
      expect(res.error, `own-site log: ${res.error?.message}`).toBeNull();
      expect(await countWhere("gate_logs", "material_owner", marker)).toBe(1);
    });

    // ── addBatchComment ───────────────────────────────────────────────────
    it("addBatchComment: another site's manager is refused by a raise, not zero rows", async () => {
      const visitId = await parkedVisit();
      const res = await mgrOld.client.from("batch_comments").insert({
        visit_id: visitId, site_id: dong, body: "cross-site note", author: mgrOld.userId,
      });
      expect(res.error).not.toBeNull();
      expect(res.error!.code).toBe("42501");
      expect(await countWhere("batch_comments", "visit_id", visitId)).toBe(0);
    });

    it("addBatchComment: an own-site comment still posts", async () => {
      const visitId = await parkedVisit();
      const res = await mgrDong.client.from("batch_comments").insert({
        visit_id: visitId, site_id: dong, body: "Rate reduced for moisture", author: mgrDong.userId,
      });
      expect(res.error, `own-site comment: ${res.error?.message}`).toBeNull();
      expect(await countWhere("batch_comments", "visit_id", visitId)).toBe(1);
    });
  });

  // ── 2h. 3E-6K issueGatePass — visible refusals, unchanged authorization ──
  describe("issueGatePass: every refusal is visible, and who may issue is unchanged", () => {
    let gm: TestUser, owner: TestUser, mgrOld: TestUser, recvOld: TestUser;
    let newSite: string, oldSite: string, materialTypeId: string, supplierId: string;
    const stamp = Date.now();
    const GP_DIR = "(manager)/manager/gate-passes";

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
      oldSite = sites!.find((s) => s.name === "Old-Site")!.id as string;
      const { data: mt } = await admin.from("material_types")
        .insert({ name: `GP 3E-6K ${stamp}` }).select("id").single();
      materialTypeId = mt!.id as string;
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `GP 3E-6K ${stamp}` }).select("id").single();
      supplierId = sup!.id as string;
      // The general manager is the New-Site manager; Old-Site's is a site manager.
      gm = await makeUser({ username: `gp6k-gm-${stamp}`, role: "manager", siteId: newSite });
      owner = await makeUser({ username: `gp6k-own-${stamp}`, role: "owner", siteId: null });
      mgrOld = await makeUser({ username: `gp6k-mgr-${stamp}`, role: "manager", siteId: oldSite });
      recvOld = await makeUser({ username: `gp6k-rcv-${stamp}`, role: "receiving", siteId: oldSite });
    });

    // Exactly the row issueGatePass builds for an issued pass or a request.
    const passRow = (who: TestUser, site: string, request: boolean, reason: string): Record<string, unknown> => ({
      site_id: site, supplier_id: supplierId, material_owner: null, material_type_id: materialTypeId,
      stock_lot_id: null, bags: null, weight_kg: null, reason, issued_by: who.userId,
      ...(request
        ? { status: "pending", requested_by: who.userId }
        : { status: "issued", authorized_by: who.userId, authorized_at: new Date().toISOString() }),
    });
    const passesFor = async (reason: string) =>
      (await adminClient().from("gate_passes").select("id, status, pass_code").eq("reason", reason)).data ?? [];

    it("the GM's own-site pass lands: one issued row, a generated code, one audit event", async () => {
      const reason = `GP6K gm ${stamp}`;
      const res = await gm.client.from("gate_passes").insert(passRow(gm, newSite, false, reason));
      expect(res.error, `GM issue: ${res.error?.message}`).toBeNull();
      const rows = await passesFor(reason);
      expect(rows, "exactly one pass").toHaveLength(1);
      expect(rows[0].status).toBe("issued");
      expect(rows[0].pass_code as string, "the code is generated on insert").toMatch(/^GP-/);
      const { count } = await adminClient().from("transaction_events")
        .select("id", { count: "exact", head: true })
        .eq("entity", "gate_passes").eq("entity_id", rows[0].id as string).eq("event_type", "record_created");
      expect(count, "exactly one audit event").toBe(1);
    });

    it("a site manager still cannot issue — refused with 42501, nothing written", async () => {
      const reason = `GP6K site mgr ${stamp}`;
      const res = await mgrOld.client.from("gate_passes").insert(passRow(mgrOld, oldSite, false, reason));
      expect(res.error, "the refusal raises — it must be surfaced, not swallowed").not.toBeNull();
      expect(res.error!.code).toBe("42501");
      expect(await passesFor(reason)).toHaveLength(0);
    });

    it("receiving still cannot create an issued pass — refused with 42501, nothing written", async () => {
      const reason = `GP6K rcv issued ${stamp}`;
      const res = await recvOld.client.from("gate_passes").insert(passRow(recvOld, oldSite, false, reason));
      expect(res.error).not.toBeNull();
      expect(res.error!.code).toBe("42501");
      expect(await passesFor(reason)).toHaveLength(0);
    });

    it("receiving's own-site pending request is still allowed", async () => {
      const reason = `GP6K rcv pending ${stamp}`;
      const res = await recvOld.client.from("gate_passes").insert(passRow(recvOld, oldSite, true, reason));
      expect(res.error, `receiving request: ${res.error?.message}`).toBeNull();
      const rows = await passesFor(reason);
      expect(rows).toHaveLength(1);
      expect(rows[0].status, "a request carries no authority until authorised").toBe("pending");
    });

    it("the owner's block is application-level: the database would accept a pass with a site", async () => {
      const reason = `GP6K owner ${stamp}`;
      const res = await owner.client.from("gate_passes").insert(passRow(owner, newSite, false, reason));
      expect(res.error, `owner insert with a site: ${res.error?.message}`).toBeNull();
      expect(await passesFor(reason)).toHaveLength(1);
    });

    it("the action refuses an owner with no site explicitly, never silently", () => {
      // Server actions cannot be invoked from this harness (getProfile needs
      // next/headers), so the contract is pinned on the code itself.
      const body = codeOf("actions.ts", "issueGatePass", GP_DIR);
      expect(body).toContain('if (!siteId) return fail("Your account has no site to issue this gate pass from.")');
      expect(body, "and no site is inferred from the lot").not.toMatch(/siteId\s*=\s*.*lot/);
    });

    it("the GM's lot picker offers own-site available lots only", async () => {
      const admin = adminClient();
      const { data: own } = await admin.from("stock_lots").insert({
        site_id: newSite, material_type_id: materialTypeId, supplier_id: supplierId, weight_kg: 12, status: "available",
      }).select("id").single();
      const { data: foreign } = await admin.from("stock_lots").insert({
        site_id: oldSite, material_type_id: materialTypeId, supplier_id: supplierId, weight_kg: 9, status: "available",
      }).select("id").single();

      // The defect: the GM reads every site's stock, so an unfiltered list
      // offered lots the action would then refuse.
      const unfiltered = await gm.client.from("stock_lots").select("id")
        .eq("status", "available").eq("material_type_id", materialTypeId);
      expect((unfiltered.data ?? []).map((l) => l.id), "without a site filter the foreign lot appears")
        .toContain(foreign!.id);

      // The picker's shape now: available AND the GM's own site.
      const picker = await gm.client.from("stock_lots").select("id")
        .eq("status", "available").eq("site_id", newSite).eq("material_type_id", materialTypeId);
      const ids = (picker.data ?? []).map((l) => l.id);
      expect(ids, "own-site lot offered").toContain(own!.id);
      expect(ids, "foreign-site lot not offered").not.toContain(foreign!.id);

      const page = source("page.tsx", GP_DIR);
      // Bounded from the lot query onward: the supplier seed query above it also
      // ends in .limit(200).
      const lotStart = page.indexOf('from("stock_lots")');
      expect(lotStart, "the page queries stock lots").toBeGreaterThan(-1);
      const lotQuery = page.slice(lotStart, page.indexOf(".limit(200)", lotStart));
      expect(lotQuery, "the page filters the lot list to the GM's site").toMatch(/\.eq\("site_id", me\.site_id\)/);
      expect(lotQuery, "and still only available lots").toMatch(/\.eq\("status", "available"\)/);
    });

    it("an unanticipated database error gets a fixed message, never raw database text", () => {
      const body = codeOf("actions.ts", "issueGatePass", GP_DIR);
      expect(body, "the known refusals keep their own messages").toMatch(/error\.code === "42501"/);
      expect(body).toMatch(/error\.code === "23503"/);
      expect(body).toMatch(/error\.code === "23514"/);
      expect(body, "the catch-all is a fixed, operator-safe message")
        .toContain('return fail("The gate pass could not be saved. Please try again.")');
      expect(body, "no database message reaches the operator").not.toContain("error.message");
    });

    it("a lot that is foreign, gone or no longer available is refused explicitly if it reaches the action", () => {
      const body = codeOf("actions.ts", "issueGatePass", GP_DIR);
      expect(body).toMatch(/if \(!lot\) return fail\(/);
      expect(body).toMatch(/if \(lot\.site_id !== siteId\) \{\s*return fail\(/);
      expect(body).toMatch(/if \(lot\.status !== "available"\) return fail\(/);
    });
  });

  // ── 3. Every one of them routes through it ───────────────────────────────
  describe("every money- or stock-touching action consumes the safe pattern", () => {
    for (const { file, fn, kind, dir } of ACTIONS) {
      it(`${fn} returns ActionResult and cannot silently succeed`, () => {
        const body = codeOf(file, fn, dir);
        expect(body, `${fn} must return ActionResult`).toContain("Promise<ActionResult>");
        expect(body, `${fn} must take the useActionState prev arg`).toContain("_prev: ActionResult");
        if (kind === "table") {
          // A table write has to ask for rows back, or zero-row denial is invisible.
          expect(body, `${fn} must .select() so refused rows are visible`).toMatch(/\.select\(/);
          expect(body, `${fn} must interpret the write with fromWrite`).toContain("fromWrite(");
        } else if (kind === "rpc") {
          // An RPC raises instead of returning rows.
          expect(body, `${fn} must check the RPC error`).toMatch(/if \(error\) return fail/);
        } else if (kind === "insert") {
          // An INSERT refused by RLS raises, so `error` is the whole signal —
          // and asking for the row back is not merely redundant here, it breaks
          // the GM's cross-site machine create. Pinned in both directions.
          expect(body, `${fn} must inspect the insert error`).toMatch(/if \(error\)/);
          expect(body, `${fn} must not use fromWrite — there is no zero-row case`)
            .not.toContain("fromWrite(");
          // Scoped to the insert STATEMENT: addBatchComment legitimately reads the
          // visit's site with a .select() before it inserts, and that is not a
          // select-back of the new row.
          const at = body.indexOf(".insert(");
          expect(at, `${fn} must perform the insert`).toBeGreaterThan(-1);
          expect(body.slice(at, body.indexOf(";", at)), `${fn} must NOT select the new row back`)
            .not.toMatch(/\.select\(/);
          if (fn === "createMachine") {
            // Stricter here, as pinned in tranche 2A: any select-back breaks the
            // GM's cross-site create (42501, row never lands).
            expect(body, "createMachine must contain no .select() at all").not.toMatch(/\.select\(/);
          }
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
        // `if (error) {` covers the insert actions, which branch on error.code
        // to give a duplicate its own message before falling through to fail().
        const guard = body.search(/if \(!\w+\.ok\) return \w+;|if \(error\) return fail|if \(error\) \{|return lineAction\(/);
        expect(guard, `${fn} must decide the write landed before revalidating`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(revalidate);
      });
    }
  });
});
