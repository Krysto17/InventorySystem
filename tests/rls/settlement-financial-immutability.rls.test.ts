import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";

// 0158 (3F-T3): pricing approval writes the settlement as a snapshot of the
// batch. Audit 3F (F-04) reproduced an accountant raising net_balance
// 100,000 -> 250,000 and paying it; T2 found the approved-but-unpaid batch's lines
// still editable underneath its settlement, and production holds a paid settlement
// whose light bill is ₦7,500 above today's charges. Now the settlement's amounts
// never change after approval, and while a settlement exists nobody — owner and
// service role included — changes any source it was computed from: the material
// lines, the visit's utility charges and its advance deductions. Correcting
// pricing means sending the settlement back first (zero payments only, 0156).

const REPEAT = 6;
const MSG_LINE = "This pricing is already approved. Send the settlement back before changing the material.";
const MSG_CHARGES = "This pricing is already approved. Send the settlement back before changing charges.";
const MSG_DEDUCTIONS = "This pricing is already approved. Send the settlement back before changing deductions.";
const MSG_FEE = "This pricing is already approved. Send the settlement back before changing the processing fee.";

describe("settlement financial immutability (0158)", () => {
  const stamp = Date.now().toString(36);
  let NS: string, DONG: string, material: string, material2: string, supplierId: string;
  let owner: TestUser, gm: TestUser, mgrDong: TestUser, mgrDong2: TestUser;
  let acctDong: TestUser, acctDong2: TestUser, genAcct: TestUser, procDong: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    NS = sites!.find((s) => s.name === "New-Site")!.id as string;
    DONG = sites!.find((s) => s.name === "Dong")!.id as string;
    owner = await makeUser({ username: `sfi-own-${stamp}`, role: "owner", siteId: null });
    gm = await makeUser({ username: `sfi-gm-${stamp}`, role: "manager", siteId: NS });
    mgrDong = await makeUser({ username: `sfi-mgr-${stamp}`, role: "manager", siteId: DONG });
    mgrDong2 = await makeUser({ username: `sfi-mgr-${stamp}`, role: "manager", siteId: DONG }); // second session
    acctDong = await makeUser({ username: `sfi-acct-${stamp}`, role: "accounting", siteId: DONG });
    acctDong2 = await makeUser({ username: `sfi-acct-${stamp}`, role: "accounting", siteId: DONG }); // second session
    genAcct = await makeUser({ username: `sfi-gacct-${stamp}`, role: "accounting", siteId: NS });
    procDong = await makeUser({ username: `sfi-proc-${stamp}`, role: "processing", siteId: DONG });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `SFI ${stamp}` }).select("id").single();
    supplierId = s!.id as string;
    // A large paid advance, so a deduction is always within debt on its own merits and
    // only the snapshot rule decides.
    // 0162 version-checks the approval step, so a fixture that only needs a PAID
    // advance inserts one rather than transitioning into it.
    await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: DONG,
      purpose: "sfi debt", amount_naira: 10_000_000, approval_status: "paid", recorded_by: owner.userId,
    });
    const { data: mts } = await adminClient().from("material_types").select("id").limit(2);
    material = mts![0].id as string;
    material2 = mts![1].id as string;
  });

  // ── fixtures ────────────────────────────────────────────────────────────────
  // A priced batch (one 1,000 kg line at 100) waiting for the owner.
  async function pricedBatch(site = DONG) {
    const admin = adminClient();
    const { data: v, error } = await admin.from("visits").insert({
      site_id: site, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "awaiting_price_approval", created_by: owner.userId,
    }).select("id").single();
    if (error) throw error;
    const visitId = v!.id as string;
    const { data: l, error: lErr } = await admin.from("visit_materials").insert({
      visit_id: visitId, material_type_id: material, weight_kg: 1000, unit_price: 100, requires_analysis: false,
    }).select("id").single();
    if (lErr) throw lErr;
    return { visitId, lineId: l!.id as string };
  }
  async function approvedBatch(site = DONG) {
    const b = await pricedBatch(site);
    expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
    const { data: st } = await adminClient().from("batch_settlements").select("id").eq("visit_id", b.visitId).single();
    return { ...b, settlementId: st!.id as string };
  }
  async function snapshot(visitId: string, lineId: string) {
    const admin = adminClient();
    const [{ data: st }, { data: line }, { data: lines }, { data: v }, { data: pays }] = await Promise.all([
      admin.from("batch_settlements").select("id, status, materials_total, light_bill_total, other_deductions_total, advance_deducted, net_balance, remaining_debt, visit_id, site_id").eq("visit_id", visitId).maybeSingle(),
      admin.from("visit_materials").select("weight_kg, unit_price, purchase_amount, material_type_id, settlement_status").eq("id", lineId).maybeSingle(),
      admin.from("visit_materials").select("id").eq("visit_id", visitId),
      admin.from("visits").select("state").eq("id", visitId).maybeSingle(),
      admin.from("settlement_payments").select("amount").eq("settlement_id", (await admin.from("batch_settlements").select("id").eq("visit_id", visitId).maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000"),
    ]);
    return { st, line, lineCount: (lines ?? []).length, state: v?.state ?? null, paid: (pays ?? []).reduce((a, p) => a + Number(p.amount), 0) };
  }
  async function liveTotals(visitId: string) {
    const { data } = await adminClient().rpc("settlement_totals", { p_visit_id: visitId });
    return (data as { materials: number; net: number }[])[0];
  }
  // Priced batch that also carries every other snapshot source: a 5,000 light bill,
  // a 2,000 "other" charge and a 3,000 advance deduction against the visit.
  async function pricedBatchWithSources(site = DONG) {
    const b = await pricedBatch(site);
    const admin = adminClient();
    const { data: lb, error: e1 } = await admin.from("utility_charges").insert({ visit_id: b.visitId, kind: "light_bill", description: "fee", amount: 5000, recorded_by: owner.userId }).select("id").single();
    const { data: ot, error: e2 } = await admin.from("utility_charges").insert({ visit_id: b.visitId, kind: "other", description: "transport", amount: 2000, recorded_by: owner.userId }).select("id").single();
    const { data: de, error: e3 } = await admin.from("advance_deductions").insert({ supplier_id: supplierId, site_id: site, ref_visit_id: b.visitId, amount: 3000, kind: "advance", recorded_by: owner.userId }).select("id").single();
    if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
    return { ...b, lightBillId: lb!.id as string, otherId: ot!.id as string, deductionId: de!.id as string };
  }
  async function approvedBatchWithSources(site = DONG) {
    const b = await pricedBatchWithSources(site);
    expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
    const { data: st } = await adminClient().from("batch_settlements").select("id").eq("visit_id", b.visitId).single();
    return { ...b, settlementId: st!.id as string };
  }
  async function sources(visitId: string) {
    const admin = adminClient();
    const [{ data: charges }, { data: deds }, { data: st }] = await Promise.all([
      admin.from("utility_charges").select("id, kind, amount, carried, description").eq("visit_id", visitId).order("id"),
      admin.from("advance_deductions").select("id, amount, notes, kind").eq("ref_visit_id", visitId).order("id"),
      admin.from("batch_settlements").select("status, light_bill_total, other_deductions_total, advance_deducted, net_balance").eq("visit_id", visitId).maybeSingle(),
    ]);
    return { charges, deds, st };
  }
  // The stored snapshot equals what settlement_totals computes from live sources.
  async function expectSnapshotMatchesSources(visitId: string, label: string) {
    const { data: st } = await adminClient().from("batch_settlements")
      .select("materials_total, light_bill_total, other_deductions_total, advance_deducted, net_balance").eq("visit_id", visitId).single();
    const { data } = await adminClient().rpc("settlement_totals", { p_visit_id: visitId });
    const t = (data as Record<string, number>[])[0];
    expect([Number(st!.materials_total), Number(st!.light_bill_total), Number(st!.other_deductions_total), Number(st!.advance_deducted), Number(st!.net_balance)], label)
      .toEqual([Number(t.materials), Number(t.processing_fee), Number(t.other_deductions), Number(t.advances), Number(t.net)]);
  }
  const rows = (res: { data: unknown[] | null; error: { message: string } | null }) => {
    expect(res.error, res.error?.message).toBeNull();
    return (res.data ?? []).length;
  };

  // ── settlement money columns (F-04) ────────────────────────────────────────
  describe("settlement amounts are never edited directly", () => {
    it("F-04: the accountant cannot raise net_balance, and no payment can be made against the raised figure", async () => {
      const { visitId, lineId, settlementId } = await approvedBatch(DONG);
      const before = await snapshot(visitId, lineId);
      expect(Number(before.st!.net_balance)).toBe(100000);

      const patch = await acctDong.client.from("batch_settlements").update({ net_balance: 250000 }).eq("id", settlementId).select("id");
      expect(patch.error?.code).toBe("SF001");
      expect(patch.error!.message).toBe("Approved settlement amounts cannot be edited directly.");
      expect((await snapshot(visitId, lineId)).st).toEqual(before.st);

      const overpay = await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 250000, p_method: "transfer" });
      expect(overpay.error, "250,000 exceeds the approved 100,000").not.toBeNull();
      const pay = await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100000, p_method: "transfer" });
      expect(pay.error).toBeNull();
      const after = await snapshot(visitId, lineId);
      expect(after.st!.status).toBe("paid");
      expect(after.paid).toBe(100000);
    });

    it("every role holding UPDATE is refused, own site and cross-site: GM, general accountant, owner", async () => {
      for (const [who, client, site] of [
        ["GM own site", gm, NS], ["GM cross-site", gm, DONG],
        ["general accountant cross-site", genAcct, DONG], ["owner", owner, DONG],
      ] as const) {
        const { visitId, lineId, settlementId } = await approvedBatch(site);
        const before = await snapshot(visitId, lineId);
        const res = await client.client.from("batch_settlements").update({ net_balance: 250000 }).eq("id", settlementId).select("id");
        expect(res.error?.code, who).toBe("SF001");
        expect((await snapshot(visitId, lineId)).st, who).toEqual(before.st);
      }
      // A site manager never had UPDATE on settlements (unchanged).
      const { settlementId } = await approvedBatch(DONG);
      expect(rows(await mgrDong.client.from("batch_settlements").update({ net_balance: 1 }).eq("id", settlementId).select("id"))).toBe(0);
    });

    it("each frozen column is refused on its own, on an approved and on a paid settlement", async () => {
      const approved = await approvedBatch(DONG);
      const paid = await approvedBatch(DONG);
      await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: paid.settlementId, p_amount: 100000, p_method: "transfer" });
      const { data: other } = await adminClient().from("visits").insert({
        site_id: DONG, supplier_id: supplierId, declared_material_type_id: material, entry_path: "processed", state: "pricing", created_by: owner.userId,
      }).select("id").single();
      const patches: Record<string, unknown>[] = [
        { materials_total: 1 }, { light_bill_total: 1 }, { other_deductions_total: 1 }, { advance_deducted: 1 },
        { net_balance: 1 }, { remaining_debt: 1 }, { visit_id: other!.id }, { site_id: NS },
      ];
      for (const b of [approved, paid]) {
        const before = await snapshot(b.visitId, b.lineId);
        for (const patch of patches) {
          const res = await owner.client.from("batch_settlements").update(patch).eq("id", b.settlementId).select("id");
          expect(res.error?.code, JSON.stringify(patch)).toBe("SF001");
        }
        expect((await snapshot(b.visitId, b.lineId)).st).toEqual(before.st);
      }
    });

    it("status workflow is untouched: hold, release, direct accountant approved→paid, notes", async () => {
      const a = await approvedBatch(DONG);
      expect((await mgrDong.client.rpc("hold_settlement", { p_id: a.settlementId })).error).toBeNull();
      expect((await mgrDong.client.rpc("release_settlement", { p_id: a.settlementId })).error).toBeNull();
      expect(rows(await acctDong.client.from("batch_settlements").update({ rejection_note: "checked" }).eq("id", a.settlementId).select("id"))).toBe(1);
      expect(rows(await acctDong.client.from("batch_settlements").update({ status: "paid" }).eq("id", a.settlementId).select("id")), "legacy approved → paid transition").toBe(1);
      expect((await snapshot(a.visitId, a.lineId)).st!.status).toBe("paid");
    });
  });

  // ── line figures while a settlement exists ─────────────────────────────────
  describe("lines are frozen under an existing settlement", () => {
    it("weight, price and material: manager, GM and owner are all refused; row and settlement unchanged", async () => {
      const { visitId, lineId } = await approvedBatch(DONG);
      const before = await snapshot(visitId, lineId);
      for (const [who, client, patch] of [
        ["site manager weight", mgrDong, { weight_kg: 5 }],
        ["GM cross-site weight", gm, { weight_kg: 5 }],
        ["owner weight", owner, { weight_kg: 5 }],
        ["owner price", owner, { unit_price: 1 }],
        ["owner material", owner, { material_type_id: material2 }],
      ] as const) {
        const res = await client.client.from("visit_materials").update(patch).eq("id", lineId).select("id");
        expect(res.error?.code, who).toBe("SF002");
        expect(res.error!.message).toBe(MSG_LINE);
      }
      // Accounting has no line UPDATE at all (unchanged).
      expect(rows(await acctDong.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id"))).toBe(0);
      expect(await snapshot(visitId, lineId)).toEqual(before);
    });

    it("unsettle / re-settle / remove / add / delete are refused too — they move the approved total", async () => {
      const { visitId, lineId } = await approvedBatch(DONG);
      const before = await snapshot(visitId, lineId);
      expect((await mgrDong.client.rpc("unsettle_line", { p_line_id: lineId, p_reason: "late" })).error?.code).toBe("SF002");
      expect((await owner.client.rpc("remove_line", { p_line_id: lineId })).error?.code).toBe("SF002");
      expect((await owner.client.from("visit_materials").delete().eq("id", lineId).select("id")).error?.code).toBe("SF002");
      expect((await owner.client.from("visit_materials").insert({ visit_id: visitId, material_type_id: material, weight_kg: 10, unit_price: 100 }).select("id")).error?.code).toBe("SF002");
      expect(await snapshot(visitId, lineId)).toEqual(before);
    });

    it("fields that do not feed the settlement stay editable", async () => {
      const { lineId } = await approvedBatch(DONG);
      expect(rows(await mgrDong.client.from("visit_materials").update({ receiving_comment: "bagged twice" }).eq("id", lineId).select("id"))).toBe(1);
    });

    it("a closed batch with NO settlement keeps the 0157 rule: owner may edit, site manager may not", async () => {
      const { data: v } = await adminClient().from("visits").insert({
        site_id: DONG, supplier_id: supplierId, declared_material_type_id: material, entry_path: "processed", state: "exited", created_by: owner.userId,
      }).select("id").single();
      const { data: l } = await adminClient().from("visit_materials").insert({ visit_id: v!.id, material_type_id: material, weight_kg: 10 }).select("id").single();
      expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 9 }).eq("id", l!.id).select("id"))).toBe(0);
      expect(rows(await owner.client.from("visit_materials").update({ weight_kg: 9 }).eq("id", l!.id).select("id"))).toBe(1);
    });

    it("delete_batch still removes a zero-payment approved batch — the cascade is not blocked", async () => {
      const { visitId, lineId } = await approvedBatch(DONG);
      expect((await owner.client.rpc("delete_batch", { p_visit_id: visitId })).error).toBeNull();
      const s = await snapshot(visitId, lineId);
      expect([s.st, s.line, s.state]).toEqual([null, null, null]);
    });
  });

  // ── lifecycle ──────────────────────────────────────────────────────────────
  describe("send-back / repricing lifecycle", () => {
    it("A. zero payments: frozen → sent back → editable → re-approval snapshots the new figures", async () => {
      const { visitId, lineId } = await approvedBatch(DONG);
      expect((await mgrDong.client.from("visit_materials").update({ weight_kg: 800 }).eq("id", lineId).select("id")).error?.code).toBe("SF002");
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "weight was wrong" })).error).toBeNull();
      const reopened = await snapshot(visitId, lineId);
      expect(reopened.st).toBeNull();
      expect(reopened.state).toBe("awaiting_price_approval");
      expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 800 }).eq("id", lineId).select("id")), "editable once the settlement is gone").toBe(1);
      expect((await approvePricingAs(owner.client, visitId)).error).toBeNull();
      const again = await snapshot(visitId, lineId);
      expect(Number(again.st!.materials_total)).toBe(80000);
      expect(Number(again.st!.net_balance)).toBe(80000);
    });

    it("B. partially paid: send-back refused (0156), lines and settlement both frozen", async () => {
      const { visitId, lineId, settlementId } = await approvedBatch(DONG);
      await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 30000, p_method: "transfer" });
      const before = await snapshot(visitId, lineId);
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "x" })).error?.code).toBe("SP001");
      expect((await owner.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id")).error?.code).toBe("SF002");
      expect((await owner.client.from("batch_settlements").update({ net_balance: 30000 }).eq("id", settlementId).select("id")).error?.code).toBe("SF001");
      expect(await snapshot(visitId, lineId)).toEqual(before);
    });

    it("C. paid: settlement and lines immutable for the owner; GM sees nothing to edit", async () => {
      const { visitId, lineId, settlementId } = await approvedBatch(DONG);
      await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100000, p_method: "transfer" });
      const before = await snapshot(visitId, lineId);
      expect(before.state).toBe("stocked");
      expect((await owner.client.from("visit_materials").update({ unit_price: 1 }).eq("id", lineId).select("id")).error?.code).toBe("SF002");
      expect((await owner.client.from("batch_settlements").update({ net_balance: 1 }).eq("id", settlementId).select("id")).error?.code).toBe("SF001");
      expect(rows(await gm.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id"))).toBe(0);
      expect(await snapshot(visitId, lineId)).toEqual(before);
    });
  });

  // ── concurrency ────────────────────────────────────────────────────────────
  describe("concurrency", () => {
    it("C1. line edit vs approve_pricing: the settlement always equals the committed lines", async () => {
      const seen = { editFirst: 0, approvalFirst: 0, staleApproval: 0 };
      for (let i = 0; i < REPEAT; i++) {
        const { visitId, lineId } = await pricedBatch(DONG);
        const [approval, edit] = await Promise.all([
          approvePricingAs(owner.client, visitId),
          mgrDong.client.from("visit_materials").update({ weight_kg: 700 }).eq("id", lineId).select("id"),
        ]);
        // 0162: an edit that commits after the owner read the pricing makes the
        // approval stale. Nothing is snapshotted from a version nobody reviewed.
        if (approval.error) {
          expect(approval.error.code, `round ${i}: only staleness may refuse`).toBe("ST001");
          expect((await adminClient().from("batch_settlements").select("id").eq("visit_id", visitId)).data ?? [],
            `round ${i}: no settlement from a stale approval`).toHaveLength(0);
          seen.staleApproval++;
          continue;
        }
        const s = await snapshot(visitId, lineId);
        const live = await liveTotals(visitId);
        expect(Number(s.st!.materials_total), `round ${i}: snapshot = committed lines`).toBe(Number(live.materials));
        if (edit.error) {
          expect(["SF002", "VM002"]).toContain(edit.error.code);
          expect(Number(s.line!.weight_kg)).toBe(1000);
          seen.approvalFirst++;
        } else {
          expect(Number(s.line!.weight_kg)).toBe(700);
          expect(Number(s.st!.materials_total)).toBe(70000);
          seen.editFirst++;
        }
      }
      expect(seen.editFirst + seen.approvalFirst + seen.staleApproval).toBe(REPEAT);
    });

    it("C2. direct net_balance patch vs payment: the patch never lands, the payment uses the approved figure", async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { visitId, lineId, settlementId } = await approvedBatch(DONG);
        const [patch, pay] = await Promise.all([
          acctDong.client.from("batch_settlements").update({ net_balance: 250000 }).eq("id", settlementId).select("id"),
          acctDong2.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100000, p_method: "transfer" }),
        ]);
        expect(patch.error?.code, `round ${i}`).toBe("SF001");
        expect(pay.error, `round ${i}`).toBeNull();
        const s = await snapshot(visitId, lineId);
        expect(Number(s.st!.net_balance)).toBe(100000);
        expect(s.st!.status).toBe("paid");
        expect(s.paid).toBe(100000);
      }
    });

    it("C3. send-back vs line edit: no edit lands under the settlement; once reopened the edit works", async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { visitId, lineId } = await approvedBatch(DONG);
        const [sendBack, edit] = await Promise.all([
          acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: `race ${i}` }),
          mgrDong2.client.from("visit_materials").update({ weight_kg: 600 }).eq("id", lineId).select("id"),
        ]);
        expect(sendBack.error, `round ${i}: send-back`).toBeNull();
        const s = await snapshot(visitId, lineId);
        expect(s.st).toBeNull();
        expect(s.state).toBe("awaiting_price_approval");
        if (edit.error) {
          expect(["SF002", "VM002"]).toContain(edit.error.code);
          expect(Number(s.line!.weight_kg)).toBe(1000);
          expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 600 }).eq("id", lineId).select("id")), "retry after reopen").toBe(1);
        } else {
          // The edit only committed after the send-back did — the settlement was
          // already gone, which is the reopened workflow.
          expect(Number(s.line!.weight_kg)).toBe(600);
        }
      }
    });
  });

  // ── utility charges and visit-linked deductions (the other snapshot sources) ─
  describe("utility charges and visit-linked deductions are frozen under a settlement", () => {
    it("17/18/19/20. utility charge INSERT, amount UPDATE, DELETE, carried/kind change: refused for manager, owner and service role", async () => {
      const b = await approvedBatchWithSources(DONG);
      const before = await sources(b.visitId);
      expect(Number(before.st!.light_bill_total)).toBe(5000);
      expect(Number(before.st!.other_deductions_total)).toBe(2000);

      const attempts: [string, PromiseLike<{ error: { code?: string } | null }>][] = [
        ["manager insert", mgrDong.client.from("utility_charges").insert({ visit_id: b.visitId, kind: "other", description: "late", amount: 100, recorded_by: mgrDong.userId }).select("id")],
        ["service-role insert", adminClient().from("utility_charges").insert({ visit_id: b.visitId, kind: "light_bill", description: "late", amount: 100 }).select("id")],
        ["manager amount update", mgrDong.client.from("utility_charges").update({ amount: 2500 }).eq("id", b.lightBillId).select("id")],
        ["owner amount update", owner.client.from("utility_charges").update({ amount: 1 }).eq("id", b.otherId).select("id")],
        ["manager delete", mgrDong.client.from("utility_charges").delete().eq("id", b.lightBillId).select("id")],
        ["service-role delete", adminClient().from("utility_charges").delete().eq("id", b.otherId).select("id")],
        ["owner carries the light bill", owner.client.from("utility_charges").update({ carried: true }).eq("id", b.lightBillId).select("id")],
        ["owner turns light bill into other", owner.client.from("utility_charges").update({ kind: "other" }).eq("id", b.lightBillId).select("id")],
      ];
      for (const [label, attempt] of attempts) {
        const res = await attempt;
        expect(res.error?.code, label).toBe("SF003");
      }
      expect(await sources(b.visitId)).toEqual(before);
      await expectSnapshotMatchesSources(b.visitId, "after refused charge edits");
    });

    it("a charge edit that does not change the snapshot still passes: description, carried on an 'other' charge", async () => {
      const b = await approvedBatchWithSources(DONG);
      expect(rows(await mgrDong.client.from("utility_charges").update({ description: "Processing fee (weighbridge)" }).eq("id", b.lightBillId).select("id"))).toBe(1);
      expect(rows(await owner.client.from("utility_charges").update({ carried: true }).eq("id", b.otherId).select("id"))).toBe(1);
      await expectSnapshotMatchesSources(b.visitId, "harmless edits");
    });

    it("21/22/23. visit-linked deduction INSERT, amount UPDATE, move onto the visit, DELETE: refused", async () => {
      const b = await approvedBatchWithSources(DONG);
      const before = await sources(b.visitId);
      expect(Number(before.st!.advance_deducted)).toBe(3000);
      const { data: loose } = await adminClient().from("advance_deductions").insert({ supplier_id: supplierId, site_id: DONG, ref_visit_id: null, amount: 500, kind: "advance", recorded_by: owner.userId }).select("id").single();

      const attempts: [string, PromiseLike<{ error: { code?: string } | null }>][] = [
        ["manager insert against the visit", mgrDong.client.from("advance_deductions").insert({ supplier_id: supplierId, site_id: DONG, ref_visit_id: b.visitId, amount: 100, kind: "advance", recorded_by: mgrDong.userId }).select("id")],
        ["service-role insert against the visit", adminClient().from("advance_deductions").insert({ supplier_id: supplierId, site_id: DONG, ref_visit_id: b.visitId, amount: 100, kind: "processing" }).select("id")],
        ["GM amount update", gm.client.from("advance_deductions").update({ amount: 3500 }).eq("id", b.deductionId).select("id")],
        ["GM moves a loose deduction onto the visit", gm.client.from("advance_deductions").update({ ref_visit_id: b.visitId }).eq("id", loose!.id).select("id")],
        ["GM moves the deduction off the visit", gm.client.from("advance_deductions").update({ ref_visit_id: null }).eq("id", b.deductionId).select("id")],
        ["manager delete", mgrDong.client.from("advance_deductions").delete().eq("id", b.deductionId).select("id")],
        ["service-role delete", adminClient().from("advance_deductions").delete().eq("id", b.deductionId).select("id")],
      ];
      for (const [label, attempt] of attempts) {
        const res = await attempt;
        expect(res.error?.code, label).toBe("SF004");
      }
      expect(await sources(b.visitId)).toEqual(before);
      // A note edit does not move the snapshot.
      expect(rows(await gm.client.from("advance_deductions").update({ notes: "recovered at payout" }).eq("id", b.deductionId).select("id"))).toBe(1);
      await expectSnapshotMatchesSources(b.visitId, "after refused deduction edits");
    });

    it("24. deductions not tied to a settled visit keep their existing rules, including the 0157 debt guard", async () => {
      await approvedBatchWithSources(DONG); // a settled visit exists for this supplier
      const repay = await mgrDong.client.rpc("record_debt_repayment", { p_supplier_id: supplierId, p_amount: 1000, p_kind: "advance" });
      expect(repay.error, "loose repayment").toBeNull();
      const { data: loose } = await adminClient().from("advance_deductions").select("id").eq("id", repay.data as string).single();
      expect(rows(await gm.client.from("advance_deductions").update({ amount: 1500 }).eq("id", loose!.id).select("id")), "increase within debt").toBe(1);
      const over = await gm.client.from("advance_deductions").update({ amount: 999_999_999 }).eq("id", loose!.id).select("id");
      expect(over.error?.code, "0157 debt guard still applies").toBe("23514");
      // A deduction against an OPEN (unsettled) visit is still recordable.
      const open = await pricedBatch(DONG);
      expect((await mgrDong.client.from("advance_deductions").insert({ supplier_id: supplierId, site_id: DONG, ref_visit_id: open.visitId, amount: 100, kind: "advance", recorded_by: mgrDong.userId }).select("id")).error).toBeNull();
    });

    it("25/26/27/28. zero payments: frozen → sent back → charge and deduction editable → re-approval snapshots the revised sources", async () => {
      const b = await approvedBatchWithSources(DONG);
      expect((await mgrDong.client.from("utility_charges").update({ amount: 4000 }).eq("id", b.lightBillId).select("id")).error?.code).toBe("SF003");
      expect((await gm.client.from("advance_deductions").update({ amount: 6000 }).eq("id", b.deductionId).select("id")).error?.code).toBe("SF004");

      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: b.visitId, p_reason: "fee and deduction wrong" })).error).toBeNull();
      expect((await sources(b.visitId)).st).toBeNull();

      expect(rows(await mgrDong.client.from("utility_charges").update({ amount: 4000 }).eq("id", b.lightBillId).select("id")), "charge editable after send-back").toBe(1);
      expect(rows(await gm.client.from("advance_deductions").update({ amount: 6000 }).eq("id", b.deductionId).select("id")), "deduction editable after send-back").toBe(1);

      expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
      const again = await sources(b.visitId);
      expect(Number(again.st!.light_bill_total), "revised charge snapshotted").toBe(4000);
      expect(Number(again.st!.advance_deducted), "revised deduction snapshotted").toBe(6000);
      expect(Number(again.st!.net_balance)).toBe(100000 - 4000 - 2000 - 6000);
      await expectSnapshotMatchesSources(b.visitId, "re-approved");
    });

    it("29. partially paid: send-back refused, charges and deductions stay frozen", async () => {
      const b = await approvedBatchWithSources(DONG);
      await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: b.settlementId, p_amount: 10000, p_method: "transfer" });
      const before = await sources(b.visitId);
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: b.visitId, p_reason: "x" })).error?.code).toBe("SP001");
      expect((await owner.client.from("utility_charges").update({ amount: 1 }).eq("id", b.lightBillId).select("id")).error?.code).toBe("SF003");
      expect((await mgrDong.client.from("advance_deductions").delete().eq("id", b.deductionId).select("id")).error?.code).toBe("SF004");
      expect(await sources(b.visitId)).toEqual(before);
    });

    it("30. paid: charges and deductions frozen for the owner and the service role", async () => {
      const b = await approvedBatchWithSources(DONG);
      await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: b.settlementId, p_amount: 90000, p_method: "transfer" });
      const before = await sources(b.visitId);
      expect(before.st!.status).toBe("paid");
      expect((await owner.client.from("utility_charges").delete().eq("id", b.otherId).select("id")).error?.code).toBe("SF003");
      expect((await adminClient().from("utility_charges").update({ amount: 1 }).eq("id", b.lightBillId).select("id")).error?.code).toBe("SF003");
      expect((await mgrDong.client.from("advance_deductions").delete().eq("id", b.deductionId).select("id")).error?.code).toBe("SF004");
      expect((await adminClient().from("advance_deductions").update({ amount: 1 }).eq("id", b.deductionId).select("id")).error?.code).toBe("SF004");
      expect(await sources(b.visitId)).toEqual(before);
    });

    it("delete_batch still removes a zero-payment approved batch whose charges cascade with it", async () => {
      const b = await pricedBatch(DONG);
      await adminClient().from("utility_charges").insert({ visit_id: b.visitId, kind: "light_bill", description: "fee", amount: 5000 });
      expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
      expect((await owner.client.rpc("delete_batch", { p_visit_id: b.visitId })).error).toBeNull();
      expect((await adminClient().from("utility_charges").select("id").eq("visit_id", b.visitId)).data ?? []).toHaveLength(0);
    });
  });

  describe("snapshot-source concurrency with approve_pricing", () => {
    it("31. utility charge INSERT / UPDATE / DELETE racing approval: stored settlement always equals live charges", async () => {
      const ops = ["insert", "update", "delete"] as const;
      for (let i = 0; i < REPEAT; i++) {
        const op = ops[i % ops.length];
        const b = await pricedBatchWithSources(DONG);
        const mutation =
          op === "insert" ? mgrDong.client.from("utility_charges").insert({ visit_id: b.visitId, kind: "other", description: "race", amount: 700, recorded_by: mgrDong.userId }).select("id")
          : op === "update" ? mgrDong.client.from("utility_charges").update({ amount: 6500 }).eq("id", b.lightBillId).select("id")
          : mgrDong.client.from("utility_charges").delete().eq("id", b.otherId).select("id");
        const [approval, mut] = await Promise.all([approvePricingAs(owner.client, b.visitId), mutation]);
        // 0162 strengthens this: the approval either lands on the version the
        // owner reviewed, or it refuses as stale — it never snapshots a charge
        // that arrived after the review.
        if (approval.error) {
          expect(approval.error.code, `round ${i} ${op}: only staleness may refuse`).toBe("ST001");
          expect((await adminClient().from("batch_settlements").select("id").eq("visit_id", b.visitId)).data ?? [],
            `round ${i} ${op}: a stale refusal creates no settlement`).toHaveLength(0);
        } else {
          if (mut.error) expect(mut.error.code, `round ${i} ${op}`).toBe("SF003");
          await expectSnapshotMatchesSources(b.visitId, `round ${i} ${op}`);
        }
      }
    });

    it("32. visit-linked deduction INSERT / UPDATE / DELETE racing approval: stored settlement always equals live deductions", async () => {
      const ops = ["insert", "update", "delete"] as const;
      for (let i = 0; i < REPEAT; i++) {
        const op = ops[i % ops.length];
        const b = await pricedBatchWithSources(DONG);
        const mutation =
          op === "insert" ? mgrDong.client.from("advance_deductions").insert({ supplier_id: supplierId, site_id: DONG, ref_visit_id: b.visitId, amount: 400, kind: "advance", recorded_by: mgrDong.userId }).select("id")
          : op === "update" ? gm.client.from("advance_deductions").update({ amount: 4500 }).eq("id", b.deductionId).select("id")
          : mgrDong.client.from("advance_deductions").delete().eq("id", b.deductionId).select("id");
        const [approval, mut] = await Promise.all([approvePricingAs(owner.client, b.visitId), mutation]);
        if (approval.error) {
          expect(approval.error.code, `round ${i} ${op}: only staleness may refuse`).toBe("ST001");
          expect((await adminClient().from("batch_settlements").select("id").eq("visit_id", b.visitId)).data ?? [],
            `round ${i} ${op}: a stale refusal creates no settlement`).toHaveLength(0);
        } else {
          if (mut.error) expect(mut.error.code, `round ${i} ${op}`).toBe("SF004");
          await expectSnapshotMatchesSources(b.visitId, `round ${i} ${op}`);
        }
      }
    });
  });

  // ── processing-fee correction is all-or-nothing ────────────────────────────
  describe("processing-fee correction under an approved settlement", () => {
    // A priced, processed batch whose fee (100 kg × ₦10 = ₦1,000 light bill) the
    // manager has sent back for correction.
    async function processedBatch() {
      const admin = adminClient();
      const { data: m1 } = await admin.from("machines").insert({ site_id: DONG, name: `SFI mill ${Math.random()}`, charge_basis: "weight", rate: 10 }).select("id").single();
      const { data: m2 } = await admin.from("machines").insert({ site_id: DONG, name: `SFI dryer ${Math.random()}`, charge_basis: "weight", rate: 20 }).select("id").single();
      const b = await pricedBatch(DONG);
      const { data: rec, error: rErr } = await admin.from("processing_records").insert({ visit_id: b.visitId, recorded_by: procDong.userId, completed_at: new Date().toISOString() }).select("id").single();
      if (rErr) throw rErr;
      await admin.from("processing_machine_usage").insert({ processing_record_id: rec!.id, machine_id: m1!.id, measurement: 100, rate_snapshot: 10 });
      await admin.from("utility_charges").insert({ visit_id: b.visitId, kind: "light_bill", description: "Processing fee", amount: 1000 });
      await admin.from("processing_records").update({ fee_reopened: true }).eq("id", rec!.id);
      return { ...b, recordId: rec!.id as string, mill: m1!.id as string, dryer: m2!.id as string };
    }
    async function feeState(visitId: string, recordId: string) {
      const admin = adminClient();
      const [{ data: usage }, { data: charges }, { data: st }, { data: rec }, { count: events }] = await Promise.all([
        admin.from("processing_machine_usage").select("id, machine_id, measurement, rate_snapshot").eq("processing_record_id", recordId).order("id"),
        admin.from("utility_charges").select("id, kind, amount, description, carried").eq("visit_id", visitId).order("id"),
        admin.from("batch_settlements").select("id, status, light_bill_total, net_balance").eq("visit_id", visitId).maybeSingle(),
        admin.from("processing_records").select("fee_reopened, discount_percent, updated_at").eq("id", recordId).single(),
        admin.from("transaction_events").select("id", { count: "exact", head: true }).eq("visit_id", visitId),
      ]);
      return { usage, charges, st, rec, events };
    }
    const newUsage = (dryer: string) => [{ machine_id: dryer, measurement: 500 }];

    it("PF 1–5. approved settlement: the correction is refused and NOTHING changes — usage, charge, settlement, record, events", async () => {
      const b = await processedBatch();
      expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
      const before = await feeState(b.visitId, b.recordId);
      expect(before.usage!.map((u) => [Number(u.measurement), Number(u.rate_snapshot)])).toEqual([[100, 10]]);
      expect(Number(before.st!.light_bill_total)).toBe(1000);

      const res = await procDong.client.rpc("resave_processing_fee", { p_visit_id: b.visitId, p_usage: newUsage(b.dryer) });
      expect(res.error?.code).toBe("SF003");
      expect(res.error!.message).toBe(MSG_FEE);

      expect(await feeState(b.visitId, b.recordId), "zero writes on refusal").toEqual(before);
    });

    it("PF 6. zero payments: sent back → the correction works again and re-approval snapshots the corrected fee", async () => {
      const b = await processedBatch();
      expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
      expect((await procDong.client.rpc("resave_processing_fee", { p_visit_id: b.visitId, p_usage: newUsage(b.dryer) })).error?.code).toBe("SF003");
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: b.visitId, p_reason: "fee was wrong" })).error).toBeNull();

      const res = await procDong.client.rpc("resave_processing_fee", { p_visit_id: b.visitId, p_usage: newUsage(b.dryer) });
      expect(res.error).toBeNull();
      const after = await feeState(b.visitId, b.recordId);
      expect(after.usage!.map((u) => [u.machine_id, Number(u.measurement), Number(u.rate_snapshot)])).toEqual([[b.dryer, 500, 20]]);
      expect(after.charges!.filter((c) => c.kind === "light_bill").map((c) => Number(c.amount))).toEqual([10000]);
      expect(after.rec!.fee_reopened).toBe(false);

      expect((await approvePricingAs(owner.client, b.visitId)).error).toBeNull();
      const snap = await feeState(b.visitId, b.recordId);
      expect(Number(snap.st!.light_bill_total)).toBe(10000);
      await expectSnapshotMatchesSources(b.visitId, "re-approved after fee correction");
    });

    it("a failure after the usage write rolls it back too (unknown machine)", async () => {
      const b = await processedBatch();
      const before = await feeState(b.visitId, b.recordId);
      const res = await procDong.client.rpc("resave_processing_fee", {
        p_visit_id: b.visitId, p_usage: [{ machine_id: "00000000-0000-0000-0000-000000000000", measurement: 5 }],
      });
      expect(res.error, "foreign key refuses the unknown machine").not.toBeNull();
      expect(await feeState(b.visitId, b.recordId)).toEqual(before);
    });

    it("PF 7/8. correction racing approval: either the corrected fee is in the snapshot, or the correction wrote nothing", async () => {
      const seen = { correctionFirst: 0, approvalFirst: 0, staleApproval: 0 };
      for (let i = 0; i < REPEAT; i++) {
        const b = await processedBatch();
        const before = await feeState(b.visitId, b.recordId);
        const [approval, correction] = await Promise.all([
          approvePricingAs(owner.client, b.visitId),
          procDong.client.rpc("resave_processing_fee", { p_visit_id: b.visitId, p_usage: newUsage(b.dryer) }),
        ]);
        // 0162: if the correction committed after the owner read the pricing,
        // the approval is stale and refuses — the corrected fee is never
        // snapshotted on the strength of a review taken before it existed.
        if (approval.error) {
          expect(approval.error.code, `round ${i}: only staleness may refuse`).toBe("ST001");
          expect(correction.error, `round ${i}: the correction is what changed`).toBeNull();
          expect((await adminClient().from("batch_settlements").select("id").eq("visit_id", b.visitId)).data ?? [],
            `round ${i}: no settlement from a stale approval`).toHaveLength(0);
          seen.staleApproval++;
          continue;
        }
        const after = await feeState(b.visitId, b.recordId);
        if (correction.error) {
          expect(correction.error.code, `round ${i}`).toBe("SF003");
          expect(after.usage, `round ${i}: usage untouched`).toEqual(before.usage);
          expect(after.charges, `round ${i}: charge untouched`).toEqual(before.charges);
          expect(Number(after.st!.light_bill_total)).toBe(1000);
          seen.approvalFirst++;
        } else {
          expect(after.usage!.map((u) => Number(u.measurement))).toEqual([500]);
          expect(Number(after.st!.light_bill_total), `round ${i}: corrected fee snapshotted`).toBe(10000);
          seen.correctionFirst++;
        }
        await expectSnapshotMatchesSources(b.visitId, `round ${i}`);
      }
      expect(seen.correctionFirst + seen.approvalFirst + seen.staleApproval).toBe(REPEAT);
    });
  });

  // ── operator messages ──────────────────────────────────────────────────────
  it("normal-screen actions map SF002 / SF003 / SF004 to fixed sentences before any raw fallback", () => {
    const src = readFileSync("src/app/visits/[id]/batch-actions.ts", "utf8");
    for (const fn of ["addMaterialLine", "updateMaterialLine", "deleteMaterialLine", "setLinePrice", "lineAction("]) {
      const at = src.indexOf(fn.endsWith("(") ? `async function ${fn}` : `export async function ${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("\n}\n", at));
      const mapped = body.indexOf('"SF002"');
      expect(mapped, `${fn} maps SF002`).toBeGreaterThan(-1);
      expect(body.slice(mapped, mapped + 250)).toContain(MSG_LINE);
      const fallbacks = [body.indexOf("fromWrite("), body.indexOf("error.message")].filter((n) => n > -1);
      for (const f of fallbacks) expect(mapped, `${fn}: before fallback`).toBeLessThan(f);
    }
    const finance = readFileSync("src/app/visits/[id]/finance-actions.ts", "utf8");
    for (const [fn, code, sentence] of [
      ["addUtilityCharge", "SF003", MSG_CHARGES], ["adjustUtilityCharge", "SF003", MSG_CHARGES], ["removeUtilityCharge", "SF003", MSG_CHARGES],
      ["recordDeduction", "SF004", MSG_DEDUCTIONS], ["removeDeduction", "SF004", MSG_DEDUCTIONS],
    ] as const) {
      const at = finance.indexOf(`export async function ${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = finance.slice(at, finance.indexOf("\n}\n", at));
      const mapped = body.indexOf(`"${code}"`);
      expect(mapped, `${fn} maps ${code}`).toBeGreaterThan(-1);
      expect(body.slice(mapped, mapped + 200)).toContain(sentence);
      expect(mapped, `${fn}: before fromWrite`).toBeLessThan(body.indexOf("fromWrite("));
    }
    const processing = readFileSync("src/app/(processing)/processing/actions.ts", "utf8");
    const save = processing.indexOf('rpc("resave_processing_fee"');
    expect(save, "fee correction goes through the atomic RPC").toBeGreaterThan(-1);
    expect(processing.slice(save, save + 500)).toContain('"SF003"');
    expect(processing.slice(save, save + 500)).toContain(MSG_FEE);
    const resave = processing.slice(processing.indexOf("export async function resaveProcessingFee"));
    expect(resave.slice(0, resave.indexOf("\n}\n")), "no separate usage writes left in the action").not.toMatch(/from\("processing_machine_usage"\)\s*\.(delete|insert)/);
    for (const m of [MSG_LINE, MSG_CHARGES, MSG_DEDUCTIONS, MSG_FEE, "Approved settlement amounts cannot be edited directly.",
      "Utility charges cannot be changed after pricing is approved.", "Advance deductions cannot be changed after pricing is approved."]) {
      expect(m).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(m).not.toMatch(/batch_settlements|visit_materials|SQLSTATE|SF00|trigger|constraint/i);
    }
  });
});
