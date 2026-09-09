import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { fromWrite } from "../../src/lib/actions/result";

/**
 * S-1: a write the database refused must not be reported as success.
 *
 * Thirty-nine server actions that move money or stock returned Promise<void>
 * and dropped the write result — nine on the visit screens (3B-2), three on
 * cost-price once 0149 gave inventory a delete path (1a2e47d), the fifteen
 * of the visit batch spine (3E-6), the seven approval/release actions of
 * 3E-6D (the owner's two cost-batch rulings, the gate's acknowledgement, the
 * advance and expense decisions, the store check, and the supplier account
 * switch), and the five money/stock deletes of 3E-6F. That matters
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
 *   3. all thirty-nine actions actually route through it.
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
        approval_status: "pending", sold: true,
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
      // Nothing stops two pending runs sharing a lot — the key is (run, lot).
      const shared = await lot(20);
      const first = await run("first claim", [shared]);
      const second = await run("second claim", [shared]);
      expect((await rule(first, "approved")).data ?? []).toHaveLength(1);

      const res = await rule(second, "approved");
      expect(res.error, "the second approval must be refused").not.toBeNull();
      expect(res.error!.message).toMatch(/already left stock/i);
      expect(fromWrite(res as never).ok).toBe(false);
      expect(await statusOfRun(second), "and the batch stays pending").toBe("pending");
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
