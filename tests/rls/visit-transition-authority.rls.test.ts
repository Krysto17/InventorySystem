import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";

// 0159 (3F-T4): a visit transition is valid only when the pair exists, the actor's
// role owns it, the actor has site authority, and its prerequisites hold. Audit 3F
// (F-05) reproduced the gate stocking an unpaid batch, processing jumping pricing →
// stocked, and accounting pulling a part-paid batch back to pricing by writing
// visits.state directly. The only direct stage write left is the gate release; every
// other move happens inside the workflow that owns it. No owner override, no
// service-role shortcut.

const REPEAT = 6;

describe("visit transition authority (0159)", () => {
  const stamp = Date.now().toString(36);
  let NS: string, DONG: string, material: string, supplierId: string;
  let owner: TestUser, gm: TestUser, mgrDong: TestUser, recvDong: TestUser, procDong: TestUser;
  let qc: TestUser, acctDong: TestUser, acctDong2: TestUser, invDong: TestUser, gateDong: TestUser, gateDong2: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    NS = sites!.find((s) => s.name === "New-Site")!.id as string;
    DONG = sites!.find((s) => s.name === "Dong")!.id as string;
    owner = await makeUser({ username: `vta-own-${stamp}`, role: "owner", siteId: null });
    gm = await makeUser({ username: `vta-gm-${stamp}`, role: "manager", siteId: NS });
    mgrDong = await makeUser({ username: `vta-mgr-${stamp}`, role: "manager", siteId: DONG });
    recvDong = await makeUser({ username: `vta-rcv-${stamp}`, role: "receiving", siteId: DONG });
    procDong = await makeUser({ username: `vta-proc-${stamp}`, role: "processing", siteId: DONG });
    qc = await makeUser({ username: `vta-qc-${stamp}`, role: "qc", siteId: NS });
    acctDong = await makeUser({ username: `vta-acct-${stamp}`, role: "accounting", siteId: DONG });
    acctDong2 = await makeUser({ username: `vta-acct-${stamp}`, role: "accounting", siteId: DONG }); // second session
    invDong = await makeUser({ username: `vta-inv-${stamp}`, role: "inventory", siteId: DONG });
    gateDong = await makeUser({ username: `vta-gate-${stamp}`, role: "gate", siteId: DONG });
    gateDong2 = await makeUser({ username: `vta-gate-${stamp}`, role: "gate", siteId: DONG }); // second session
    const { data: s } = await adminClient().from("suppliers").insert({ name: `VTA ${stamp}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    material = mt!.id as string;
  });

  // ── fixtures (visits are INSERTED in their starting state: inserts are not
  //    transitions, and nothing below PATCHes a stage with the service key) ────
  async function visit(state: string, site = DONG, entryPath = "processed") {
    const { data, error } = await adminClient().from("visits").insert({
      site_id: site, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: entryPath, state, created_by: owner.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function line(visitId: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await adminClient().from("visit_materials").insert({
      visit_id: visitId, material_type_id: material, weight_kg: 1000, unit_price: 100, requires_analysis: false, ...extra,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function approvedBatch(site = DONG) {
    const v = await visit("awaiting_price_approval", site);
    await line(v);
    expect((await approvePricingAs(owner.client, v)).error).toBeNull();
    const { data: st } = await adminClient().from("batch_settlements").select("id").eq("visit_id", v).single();
    return { visitId: v, settlementId: st!.id as string };
  }
  const stateOf = async (id: string) =>
    (await adminClient().from("visits").select("state").eq("id", id).single()).data!.state as string;
  const rows = (res: { data: unknown[] | null; error: { message: string } | null }) => {
    expect(res.error, res.error?.message).toBeNull();
    return (res.data ?? []).length;
  };

  // ── F-05 regressions: direct authenticated writes ─────────────────────────
  describe("direct stage writes are refused", () => {
    it("1. gate: in_accounting → stocked on an unpaid batch", async () => {
      const { visitId } = await approvedBatch();
      const res = await gateDong.client.from("visits").update({ state: "stocked" }).eq("id", visitId).select("id");
      expect(res.error?.code).toBe("VT001");
      expect(await stateOf(visitId)).toBe("in_accounting");
    });

    it("2. processing: pricing → stocked", async () => {
      const v = await visit("pricing");
      const res = await procDong.client.from("visits").update({ state: "stocked" }).eq("id", v).select("id");
      expect(res.error?.code).toBe("VT001");
      expect(await stateOf(v)).toBe("pricing");
    });

    it("3. accounting: part-paid in_accounting → pricing, and the protected send-back refuses too", async () => {
      const { visitId, settlementId } = await approvedBatch();
      expect((await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 30000, p_method: "transfer", p_request_key: crypto.randomUUID() })).error).toBeNull();
      const direct = await acctDong.client.from("visits").update({ state: "pricing" }).eq("id", visitId).select("id");
      expect(direct.error?.code).toBe("VT001");
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "x" })).error?.code).toBe("SP001");
      expect(await stateOf(visitId)).toBe("in_accounting");
      const { data: pays } = await adminClient().from("settlement_payments").select("id").eq("settlement_id", settlementId);
      expect(pays ?? []).toHaveLength(1);
    });

    it("4. receiving: no later-stage move, directly or through a manager's workflow", async () => {
      const v = await visit("in_qc");
      await line(v);
      expect(rows(await recvDong.client.from("visits").update({ state: "in_accounting" }).eq("id", v).select("id")), "no direct UPDATE right").toBe(0);
      expect((await recvDong.client.rpc("manager_skip_to_pricing", { p_visit_id: v })).error).not.toBeNull();
      expect(await stateOf(v)).toBe("in_qc");
    });

    it("5. manager: no owner / accounting transition", async () => {
      const v = await visit("awaiting_price_approval");
      await line(v);
      expect((await approvePricingAs(mgrDong.client, v)).error).not.toBeNull();
      expect(rows(await mgrDong.client.from("visits").update({ state: "in_accounting" }).eq("id", v).select("id"))).toBe(0);
      const { visitId } = await approvedBatch();
      expect((await mgrDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "x" })).error).not.toBeNull();
      expect(await stateOf(v)).toBe("awaiting_price_approval");
      expect(await stateOf(visitId)).toBe("in_accounting");
    });

    it("6. GM, own and foreign site: no accounting, gate or processing transition", async () => {
      for (const site of [NS, DONG]) {
        const { visitId } = await approvedBatch(site);
        expect((await gm.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "x" })).error, "accounting send-back").not.toBeNull();
        expect((await gm.client.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: "x" })).error, "accounting reversal").not.toBeNull();
        expect(rows(await gm.client.from("visits").update({ state: "stocked" }).eq("id", visitId).select("id")), "direct stock").toBe(0);

        const exitV = await visit("awaiting_gate_exit", site);
        await adminClient().from("gate_exit_authorizations").insert({ visit_id: exitV, authorized_by: owner.userId });
        expect(rows(await gm.client.from("visits").update({ state: "exited" }).eq("id", exitV).select("id")), "gate release").toBe(0);

        const procV = await visit("in_processing", site, "unprocessed");
        const pr = await gm.client.from("processing_records").insert({ visit_id: procV, recorded_by: gm.userId });
        expect(pr.error, "processing hand-off").not.toBeNull();
        expect([await stateOf(visitId), await stateOf(exitV), await stateOf(procV)]).toEqual(["in_accounting", "awaiting_gate_exit", "in_processing"]);
      }
    });

    it("7. owner: an illegal pair is refused", async () => {
      const v = await visit("in_receiving");
      await line(v);
      for (const to of ["stocked", "in_accounting", "in_processing"]) {
        const res = await owner.client.from("visits").update({ state: to }).eq("id", v).select("id");
        expect(res.error?.code, to).toBe("VT001");
      }
      expect(await stateOf(v)).toBe("in_receiving");
    });

    it("8. owner: prerequisites are not bypassed — no release without authorisation, no manual stocking", async () => {
      const exitV = await visit("awaiting_gate_exit");
      const rel = await owner.client.from("visits").update({ state: "exited" }).eq("id", exitV).select("id");
      expect(rel.error?.message).toMatch(/gate exit authorization/);
      expect(await stateOf(exitV)).toBe("awaiting_gate_exit");

      const { visitId } = await approvedBatch();
      const stock = await owner.client.from("visits").update({ state: "stocked" }).eq("id", visitId).select("id");
      expect(stock.error?.code).toBe("VT001");
      expect(await stateOf(visitId)).toBe("in_accounting");
    });

    it("the service key gets no shortcut either", async () => {
      const { visitId } = await approvedBatch();
      const res = await adminClient().from("visits").update({ state: "stocked" }).eq("id", visitId).select("id");
      expect(res.error?.code).toBe("VT001");
      const v = await visit("in_processing", DONG, "unprocessed");
      expect((await adminClient().from("visits").update({ state: "in_receiving" }).eq("id", v).select("id")).error?.code).toBe("VT001");
    });
  });

  // ── legitimate workflows keep working ─────────────────────────────────────
  describe("each role's own transitions still work", () => {
    it("9. receiving: analysis → pricing, submit → in_qc, reopen → in_receiving", async () => {
      const a = await visit("in_receiving");
      expect((await recvDong.client.from("analysis_records").insert({ visit_id: a, weight: 10, recorded_by: recvDong.userId })).error).toBeNull();
      expect(await stateOf(a)).toBe("pricing");

      const b = await visit("in_receiving");
      await line(b);
      expect((await recvDong.client.rpc("submit_visit_to_manager", { p_visit_id: b })).error).toBeNull();
      expect(await stateOf(b)).toBe("in_qc");
      expect((await recvDong.client.rpc("reopen_receiving", { p_visit_id: b })).error).toBeNull();
      expect(await stateOf(b)).toBe("in_receiving");
    });

    it("10. processing: record → in_receiving; dressing-only close → exited", async () => {
      const v = await visit("in_processing", DONG, "unprocessed");
      expect((await procDong.client.from("processing_records").insert({ visit_id: v, recorded_by: procDong.userId })).error).toBeNull();
      expect(await stateOf(v)).toBe("in_receiving");
      await adminClient().from("utility_charges").insert({ visit_id: v, kind: "light_bill", description: "fee", amount: 500 });
      expect((await procDong.client.rpc("close_dressing_only", { p_visit_id: v, p_carry: true })).error).toBeNull();
      expect(await stateOf(v)).toBe("exited");
    });

    it("11. QC: the last submitted analysis → pricing (cross-site)", async () => {
      const v = await visit("in_qc");
      const l = await line(v, { requires_analysis: true });
      expect((await qc.client.from("xrf_records").insert({ visit_material_id: l, result: "Sn 60%", weight_kg: 1000, submitted: true, recorded_by: qc.userId })).error).toBeNull();
      expect(await stateOf(v)).toBe("pricing");
    });

    it("12. manager: skip to pricing, agreed → approval, not agreed → gate exit", async () => {
      const q = await visit("in_qc");
      await line(q, { requires_analysis: true });
      expect((await mgrDong.client.rpc("manager_skip_to_pricing", { p_visit_id: q })).error).toBeNull();
      expect(await stateOf(q)).toBe("pricing");

      const agreed = await visit("pricing");
      await line(agreed);
      expect((await mgrDong.client.from("pricing").insert({ visit_id: agreed, unit_price: 100, agreement_status: "agreed", payment_terms: "immediate", priced_by: mgrDong.userId })).error).toBeNull();
      expect(await stateOf(agreed)).toBe("awaiting_price_approval");

      const notAgreed = await visit("pricing");
      expect((await mgrDong.client.from("pricing").insert({ visit_id: notAgreed, agreement_status: "not_agreed", priced_by: mgrDong.userId })).error).toBeNull();
      expect(await stateOf(notAgreed)).toBe("awaiting_gate_exit");
    });

    it("13. GM cross-site manager transitions work; a site manager's do not cross sites", async () => {
      const p = await visit("pricing", DONG);
      await line(p);
      expect((await gm.client.from("pricing").insert({ visit_id: p, unit_price: 100, agreement_status: "agreed", payment_terms: "immediate", priced_by: gm.userId })).error).toBeNull();
      expect(await stateOf(p)).toBe("awaiting_price_approval");

      const q = await visit("in_qc", DONG);
      await line(q, { requires_analysis: true });
      expect((await gm.client.rpc("manager_skip_to_pricing", { p_visit_id: q })).error).toBeNull();
      expect(await stateOf(q)).toBe("pricing");

      // GM parity (0159): dressing-only close on another site.
      const d = await visit("in_receiving", DONG);
      await adminClient().from("utility_charges").insert({ visit_id: d, kind: "light_bill", description: "fee", amount: 500 });
      expect((await gm.client.rpc("close_dressing_only", { p_visit_id: d, p_carry: false })).error).toBeNull();
      expect(await stateOf(d)).toBe("exited");

      const foreign = await visit("in_receiving", NS);
      await adminClient().from("utility_charges").insert({ visit_id: foreign, kind: "light_bill", description: "fee", amount: 500 });
      expect((await mgrDong.client.rpc("close_dressing_only", { p_visit_id: foreign, p_carry: false })).error, "site manager, other site").not.toBeNull();
      expect(await stateOf(foreign)).toBe("in_receiving");
    });

    it("14. accounting: the protected send-backs on a zero-payment settlement", async () => {
      const a = await approvedBatch();
      expect((await acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: a.visitId, p_reason: "review" })).error).toBeNull();
      expect(await stateOf(a.visitId)).toBe("awaiting_price_approval");

      const b = await approvedBatch();
      expect((await acctDong.client.rpc("send_settlement_back", { p_id: b.settlementId, p_reason: "fix" })).error).toBeNull();
      expect(await stateOf(b.visitId)).toBe("pricing");
    });

    it("15. gate: releases an authorised supplier on its own site, not on another", async () => {
      const v = await visit("awaiting_gate_exit");
      await adminClient().from("gate_exit_authorizations").insert({ visit_id: v, authorized_by: owner.userId });
      expect(rows(await gateDong.client.from("visits").update({ state: "exited" }).eq("id", v).select("id"))).toBe(1);
      expect(await stateOf(v)).toBe("exited");

      const other = await visit("awaiting_gate_exit", NS);
      await adminClient().from("gate_exit_authorizations").insert({ visit_id: other, authorized_by: owner.userId });
      expect(rows(await gateDong.client.from("visits").update({ state: "exited" }).eq("id", other).select("id"))).toBe(0);
      expect(await stateOf(other)).toBe("awaiting_gate_exit");
    });

    it("16. the payment workflow stocks the batch — paid by accounting, or in cash by inventory", async () => {
      const a = await approvedBatch();
      expect((await acctDong.client.rpc("record_settlement_payment", { p_settlement_id: a.settlementId, p_amount: 100000, p_method: "transfer", p_request_key: crypto.randomUUID() })).error).toBeNull();
      expect(await stateOf(a.visitId)).toBe("stocked");

      const b = await approvedBatch();
      expect((await invDong.client.rpc("record_settlement_payment", { p_settlement_id: b.settlementId, p_amount: 100000, p_method: "cash", p_request_key: crypto.randomUUID() })).error).toBeNull();
      expect(await stateOf(b.visitId)).toBe("stocked");
      const { data: lots } = await adminClient().from("stock_lots").select("id, ref_visit_material_id");
      expect((lots ?? []).length).toBeGreaterThan(0);
    });
  });

  // ── 17. retired legacy transitions ────────────────────────────────────────
  describe("17. retired legacy pairs are refused, owner included", () => {
    const retired: [string, string][] = [
      ["in_receiving", "awaiting_manager"], ["awaiting_manager", "in_qc"], ["awaiting_manager", "pricing"],
      ["pricing", "in_accounting"], ["pricing", "stocked"],
      ["in_accounting", "awaiting_stock_intake"], ["awaiting_stock_intake", "stocked"],
    ];
    for (const [from, to] of retired) {
      it(`${from} → ${to}`, async () => {
        const v = await visit(from);
        await line(v);
        const res = await owner.client.from("visits").update({ state: to }).eq("id", v).select("id");
        expect(res.error?.code).toBe("VT001");
        expect(await stateOf(v)).toBe(from);
      });
    }

    it("approve_visit_by_manager can no longer move a visit out of awaiting_manager", async () => {
      const v = await visit("awaiting_manager");
      await line(v);
      expect((await owner.client.rpc("approve_visit_by_manager", { p_visit_id: v, p_skip_qc: false })).error?.code).toBe("VT001");
      expect(await stateOf(v)).toBe("awaiting_manager");
    });
  });

  // ── concurrency ───────────────────────────────────────────────────────────
  describe("concurrency", () => {
    it("A. payment stocking the batch vs the gate forcing stocked: only the workflow moves it", async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { visitId, settlementId } = await approvedBatch();
        const [pay, forced] = await Promise.all([
          acctDong.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100000, p_method: "transfer", p_request_key: crypto.randomUUID() }),
          gateDong.client.from("visits").update({ state: "stocked" }).eq("id", visitId).select("id"),
        ]);
        expect(pay.error, `round ${i}: payment`).toBeNull();
        expect(await stateOf(visitId)).toBe("stocked");
        // The gate either was refused, or found the visit already stocked (a no-op).
        if (forced.error) expect(forced.error.code).toBe("VT001");
        const { data: moves } = await adminClient().from("transaction_events")
          .select("actor_id, payload").eq("visit_id", visitId).eq("event_type", "state_changed");
        const toStocked = (moves ?? []).filter((m) => (m.payload as { to?: string }).to === "stocked");
        expect(toStocked, `round ${i}: exactly one stocking`).toHaveLength(1);
        expect(toStocked[0].actor_id, `round ${i}: by the payer`).toBe(acctDong.userId);
        const { data: st } = await adminClient().from("batch_settlements").select("status").eq("id", settlementId).single();
        expect(st!.status).toBe("paid");
      }
    });

    it("B. protected send-back vs the payment moving it forward: exactly one wins", async () => {
      const seen = { sendBack: 0, payment: 0 };
      for (let i = 0; i < REPEAT; i++) {
        const { visitId, settlementId } = await approvedBatch();
        const [back, pay] = await Promise.all([
          acctDong.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: `race ${i}` }),
          acctDong2.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100000, p_method: "transfer", p_request_key: crypto.randomUUID() }),
        ]);
        const state = await stateOf(visitId);
        const { data: st } = await adminClient().from("batch_settlements").select("status").eq("visit_id", visitId).maybeSingle();
        if (back.error === null) {
          expect(pay.error, `round ${i}`).not.toBeNull();
          expect(state).toBe("awaiting_price_approval");
          expect(st).toBeNull();
          seen.sendBack++;
        } else {
          expect(pay.error, `round ${i}`).toBeNull();
          expect(state).toBe("stocked");
          expect(st!.status).toBe("paid");
          seen.payment++;
        }
      }
      expect(seen.sendBack + seen.payment).toBe(REPEAT);
    });
  });

  it("the gate release maps VT001 to a fixed sentence", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/visits/[id]/gate-exit-actions.ts", "utf8");
    const at = src.indexOf('update({ state: "exited" })');
    const after = src.slice(at, at + 600);
    expect(after).toContain('"VT001"');
    expect(after).toContain("You cannot move this visit to that stage.");
    expect(after.indexOf('"VT001"')).toBeLessThan(after.indexOf("fromWrite("));
  });
});
