import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// 0157 (3F-T2): the general manager (the New-Site manager) keeps cross-site
// authority but gets the normal workflow's state rules. Audit 3F reproduced the
// GM alone, via hand-built API writes, deleting a paid settlement and a paid
// advance, rewriting a stocked batch's line, and pushing a deduction past the
// supplier's debt. Every case below runs the GM on its OWN site and on a FOREIGN
// one — the site never decides the outcome — beside a site manager on their own
// and a foreign site, whose rules are unchanged.

const REPEAT = 6;

describe("GM cross-site state integrity (0157)", () => {
  const stamp = Date.now().toString(36);
  let NS: string, DONG: string, material: string, supplierId: string;
  let owner: TestUser, gm: TestUser, gm2: TestUser, mgrDong: TestUser, recvDong: TestUser, acctDong: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    NS = sites!.find((s) => s.name === "New-Site")!.id as string;
    DONG = sites!.find((s) => s.name === "Dong")!.id as string;
    owner = await makeUser({ username: `gmsi-own-${stamp}`, role: "owner", siteId: null });
    gm = await makeUser({ username: `gmsi-gm-${stamp}`, role: "manager", siteId: NS });
    gm2 = await makeUser({ username: `gmsi-gm-${stamp}`, role: "manager", siteId: NS }); // second session
    mgrDong = await makeUser({ username: `gmsi-mgr-${stamp}`, role: "manager", siteId: DONG });
    recvDong = await makeUser({ username: `gmsi-rcv-${stamp}`, role: "receiving", siteId: DONG });
    acctDong = await makeUser({ username: `gmsi-acct-${stamp}`, role: "accounting", siteId: DONG });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `GMSI ${stamp}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    material = mt!.id as string;
  });

  // ── fixtures ────────────────────────────────────────────────────────────────
  async function visit(site: string, state: string, supplier = supplierId) {
    const { data, error } = await adminClient().from("visits").insert({
      site_id: site, supplier_id: supplier, declared_material_type_id: material,
      entry_path: "processed", state, created_by: owner.userId,
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
  // The reproduced shape: owner approves, the batch is paid in full, stock intake
  // writes the lot and marks the visit stocked — the real RPC path.
  async function stockedPaidBatch(site: string) {
    const visitId = await visit(site, "awaiting_price_approval");
    const lineId = await line(visitId);
    expect((await owner.client.rpc("approve_pricing", { p_visit_id: visitId })).error).toBeNull();
    const { data: st } = await adminClient().from("batch_settlements").select("id, net_balance").eq("visit_id", visitId).single();
    const pay = await owner.client.rpc("record_settlement_payment", {
      p_settlement_id: st!.id, p_amount: Number(st!.net_balance), p_method: "transfer",
    });
    expect(pay.error).toBeNull();
    return { visitId, lineId, settlementId: st!.id as string };
  }
  async function batchState(visitId: string, lineId: string) {
    const admin = adminClient();
    const [{ data: v }, { data: l }, { data: st }, { data: lot }] = await Promise.all([
      admin.from("visits").select("state").eq("id", visitId).single(),
      admin.from("visit_materials").select("weight_kg, unit_price, purchase_amount").eq("id", lineId).single(),
      admin.from("batch_settlements").select("status, materials_total, net_balance").eq("visit_id", visitId).maybeSingle(),
      admin.from("stock_lots").select("weight_kg, cost_price_per_kg").eq("ref_visit_material_id", lineId).maybeSingle(),
    ]);
    return { v, l, st, lot };
  }
  async function charge(visitId: string) {
    const { data, error } = await adminClient().from("utility_charges").insert({
      visit_id: visitId, kind: "other", description: "gmsi", amount: 1000, recorded_by: owner.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function pricingRow(visitId: string) {
    const { data, error } = await adminClient().from("pricing").insert({
      visit_id: visitId, agreement_status: "pending", unit_price: 100, payment_terms: "immediate", priced_by: owner.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function advance(site: string, status: "pending" | "approved" | "paid", amount = 50000, supplier = supplierId) {
    const admin = adminClient();
    const { data, error } = await admin.from("advances").insert({
      supplier_id: supplier, site_id: site, purpose: "gmsi", amount_naira: amount, approval_status: "pending", recorded_by: owner.userId,
    }).select("id").single();
    if (error) throw error;
    const id = data!.id as string;
    if (status !== "pending") await admin.from("advances").update({ approval_status: "approved" }).eq("id", id);
    if (status === "paid") await admin.from("advances").update({ approval_status: "paid" }).eq("id", id);
    return id;
  }
  // A refusal by RLS is zero rows with NO error; an error would be a different
  // failure hiding behind the same count, so every count asserts there was none.
  const rows = (res: { data: unknown[] | null; error: { message: string } | null }) => {
    expect(res.error, res.error?.message).toBeNull();
    return (res.data ?? []).length;
  };

  // ── visit_materials ────────────────────────────────────────────────────────
  describe("visit_materials", () => {
    it("UPDATE on an open batch: GM own + foreign succeed; site manager own succeeds, foreign fails", async () => {
      const nsLine = await line(await visit(NS, "pricing"));
      const dongLine = await line(await visit(DONG, "pricing"));
      expect(rows(await gm.client.from("visit_materials").update({ weight_kg: 900 }).eq("id", nsLine).select("id")), "GM own site").toBe(1);
      expect(rows(await gm.client.from("visit_materials").update({ weight_kg: 900 }).eq("id", dongLine).select("id")), "GM foreign site").toBe(1);
      const dong2 = await line(await visit(DONG, "pricing"));
      const ns2 = await line(await visit(NS, "pricing"));
      expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 900 }).eq("id", dong2).select("id")), "site manager own").toBe(1);
      expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 900 }).eq("id", ns2).select("id")), "site manager foreign").toBe(0);
    });

    for (const where of ["own", "foreign"] as const) {
      it(`6/7. GM cannot rewrite weight or price on a stocked, paid batch (${where} site) — line, settlement, lot unchanged`, async () => {
        const { visitId, lineId } = await stockedPaidBatch(where === "own" ? NS : DONG);
        const before = await batchState(visitId, lineId);
        expect(before.v!.state).toBe("stocked");
        expect(before.st!.status).toBe("paid");
        expect(Number(before.l!.purchase_amount)).toBe(100000);

        const w = await gm.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id");
        expect(w.error).toBeNull();
        expect(rows(w), "weight edit matched no row").toBe(0);
        const p = await gm.client.from("visit_materials").update({ unit_price: 1 }).eq("id", lineId).select("id");
        expect(rows(p), "price edit matched no row").toBe(0);

        const after = await batchState(visitId, lineId);
        expect(after.l).toEqual(before.l);
        expect(after.st).toEqual(before.st);
        expect(after.lot).toEqual(before.lot);
        expect(Number(after.lot!.weight_kg)).toBe(1000);
      });
    }

    it("the site manager is still refused on its own stocked batch; the owner's authority is unchanged", async () => {
      const { lineId } = await stockedPaidBatch(DONG);
      expect(rows(await mgrDong.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id"))).toBe(0);
      expect(rows(await owner.client.from("visit_materials").update({ receiving_comment: "owner note" }).eq("id", lineId).select("id")), "owner").toBe(1);
    });

    it("8. INSERT: GM may add lines cross-site while receiving or pricing, never once approved or stocked", async () => {
      for (const [state, ok] of [["in_receiving", true], ["pricing", true], ["in_accounting", false], ["stocked", false]] as const) {
        for (const site of [NS, DONG]) {
          const v = await visit(site, state);
          const { error } = await gm.client.from("visit_materials").insert({ visit_id: v, material_type_id: material, weight_kg: 10 });
          expect(error === null, `GM insert ${state} @${site === NS ? "own" : "foreign"}`).toBe(ok);
        }
      }
      // Site manager: own pricing yes, foreign no — unchanged.
      expect((await mgrDong.client.from("visit_materials").insert({ visit_id: await visit(DONG, "pricing"), material_type_id: material, weight_kg: 10 })).error).toBeNull();
      expect((await mgrDong.client.from("visit_materials").insert({ visit_id: await visit(NS, "pricing"), material_type_id: material, weight_kg: 10 })).error).not.toBeNull();
      // Unrelated role: receiving on its own in_receiving batch — unchanged.
      expect((await recvDong.client.from("visit_materials").insert({ visit_id: await visit(DONG, "in_receiving"), material_type_id: material, weight_kg: 10 })).error).toBeNull();
    });

    it("DELETE: GM removes a draft line cross-site in receiving; not at pricing or after; remove_line RPC unchanged", async () => {
      const draft = await line(await visit(DONG, "in_receiving"));
      expect(rows(await gm.client.from("visit_materials").delete().eq("id", draft).select("id")), "receiving draft").toBe(1);
      const pricingVisit = await visit(DONG, "pricing");
      const priced = await line(pricingVisit);
      expect(rows(await gm.client.from("visit_materials").delete().eq("id", priced).select("id")), "pricing, direct").toBe(0);
      expect((await gm.client.rpc("remove_line", { p_line_id: priced })).error, "pricing, via remove_line").toBeNull();
      const closed = await line(await visit(DONG, "stocked"));
      expect(rows(await gm.client.from("visit_materials").delete().eq("id", closed).select("id")), "stocked").toBe(0);
    });
  });

  // ── pricing / utility_charges ──────────────────────────────────────────────
  describe("pricing and utility charges", () => {
    it("pricing: GM writes cross-site while open, not on a closed batch", async () => {
      for (const site of [NS, DONG]) {
        expect((await gm.client.from("pricing").insert({ visit_id: await visit(site, "pricing"), agreement_status: "pending" })).error).toBeNull();
        expect((await gm.client.from("pricing").insert({ visit_id: await visit(site, "in_accounting"), agreement_status: "pending" })).error).not.toBeNull();
        const open = await pricingRow(await visit(site, "pricing"));
        const openUpdate = await gm.client.from("pricing").update({ payment_terms: "deferred" }).eq("id", open).select("id");
        expect(openUpdate.error).toBeNull();
        expect(rows(openUpdate)).toBe(1);
        const closed = await pricingRow(await visit(site, "stocked"));
        const closedUpdate = await gm.client.from("pricing").update({ unit_price: 1 }).eq("id", closed).select("id");
        expect(closedUpdate.error, "refused by RLS, not by an error").toBeNull();
        expect(rows(closedUpdate)).toBe(0);
        expect(rows(await gm.client.from("pricing").delete().eq("id", closed).select("id"))).toBe(0);
        expect(rows(await gm.client.from("pricing").delete().eq("id", open).select("id"))).toBe(1);
      }
      expect((await mgrDong.client.from("pricing").insert({ visit_id: await visit(DONG, "pricing"), agreement_status: "pending" })).error).toBeNull();
      expect((await mgrDong.client.from("pricing").insert({ visit_id: await visit(NS, "pricing"), agreement_status: "pending" })).error).not.toBeNull();
    });

    it("utility charges: GM writes cross-site while open, not on a closed batch; site manager own-site only", async () => {
      for (const site of [NS, DONG]) {
        const open = await visit(site, "pricing");
        expect((await gm.client.from("utility_charges").insert({ visit_id: open, kind: "other", description: "x", amount: 10, recorded_by: gm.userId })).error).toBeNull();
        const closedVisit = await visit(site, "stocked");
        expect((await gm.client.from("utility_charges").insert({ visit_id: closedVisit, kind: "other", description: "x", amount: 10, recorded_by: gm.userId })).error).not.toBeNull();
        const openCharge = await charge(open);
        const closedCharge = await charge(closedVisit);
        expect(rows(await gm.client.from("utility_charges").update({ amount: 20 }).eq("id", openCharge).select("id"))).toBe(1);
        expect(rows(await gm.client.from("utility_charges").update({ amount: 1 }).eq("id", closedCharge).select("id"))).toBe(0);
        expect(rows(await gm.client.from("utility_charges").delete().eq("id", closedCharge).select("id"))).toBe(0);
        expect(rows(await gm.client.from("utility_charges").delete().eq("id", openCharge).select("id"))).toBe(1);
      }
      const own = await charge(await visit(DONG, "pricing"));
      const foreign = await charge(await visit(NS, "pricing"));
      expect(rows(await mgrDong.client.from("utility_charges").update({ amount: 20 }).eq("id", own).select("id"))).toBe(1);
      expect(rows(await mgrDong.client.from("utility_charges").update({ amount: 20 }).eq("id", foreign).select("id"))).toBe(0);
    });
  });

  // ── batch_settlements ──────────────────────────────────────────────────────
  describe("batch_settlements direct DELETE", () => {
    async function settlementRow(site: string, status: string) {
      const visitId = await visit(site, status === "paid" ? "stocked" : "in_accounting");
      const { data, error } = await adminClient().from("batch_settlements").insert({
        visit_id: visitId, site_id: site, materials_total: 1000, light_bill_total: 0, other_deductions_total: 0,
        advance_deducted: 0, net_balance: 1000, submitted_by: owner.userId, status,
        ...(status === "paid" ? { paid_by: owner.userId, paid_at: new Date().toISOString() } : {}),
      }).select("id").single();
      if (error) throw error;
      return data!.id as string;
    }
    const stillThere = async (id: string) =>
      (await adminClient().from("batch_settlements").select("id").eq("id", id).maybeSingle()).data != null;

    it("1. GM cannot delete a modern paid settlement (payments remain), own or foreign site", async () => {
      for (const site of [NS, DONG]) {
        const { settlementId } = await stockedPaidBatch(site);
        const res = await gm.client.from("batch_settlements").delete().eq("id", settlementId).select("id");
        expect(rows(res)).toBe(0);
        expect(await stillThere(settlementId)).toBe(true);
        const { data: pays } = await adminClient().from("settlement_payments").select("id").eq("settlement_id", settlementId);
        expect(pays ?? []).toHaveLength(1);
      }
    });

    it("2. GM cannot delete a legacy paid settlement that has no payment rows", async () => {
      for (const site of [NS, DONG]) {
        const id = await settlementRow(site, "paid");
        const { data: pays } = await adminClient().from("settlement_payments").select("id").eq("settlement_id", id);
        expect(pays ?? [], "legacy shape: no payment rows").toHaveLength(0);
        expect(rows(await gm.client.from("batch_settlements").delete().eq("id", id).select("id"))).toBe(0);
        expect(await stillThere(id)).toBe(true);
      }
    });

    it("3. GM may delete only what delete_batch lets it remove: pending yes, approved no", async () => {
      const pending = await settlementRow(DONG, "pending");
      expect(rows(await gm.client.from("batch_settlements").delete().eq("id", pending).select("id"))).toBe(1);
      const approved = await settlementRow(DONG, "approved");
      expect(rows(await gm.client.from("batch_settlements").delete().eq("id", approved).select("id"))).toBe(0);
      expect(await stillThere(approved)).toBe(true);
      const mine = await settlementRow(DONG, "pending");
      expect(rows(await mgrDong.client.from("batch_settlements").delete().eq("id", mine).select("id")), "site manager: no delete policy (unchanged)").toBe(0);
    });
  });

  // ── advances ───────────────────────────────────────────────────────────────
  describe("advances DELETE", () => {
    it("4/5. GM deletes a non-paid advance on any site, never a paid one; site manager unchanged", async () => {
      for (const site of [NS, DONG]) {
        expect(rows(await gm.client.from("advances").delete().eq("id", await advance(site, "pending")).select("id")), "pending").toBe(1);
        expect(rows(await gm.client.from("advances").delete().eq("id", await advance(site, "approved")).select("id")), "approved").toBe(1);
        const paid = await advance(site, "paid");
        expect(rows(await gm.client.from("advances").delete().eq("id", paid).select("id")), "paid").toBe(0);
        expect((await adminClient().from("advances").select("approval_status").eq("id", paid).single()).data!.approval_status).toBe("paid");
      }
      expect(rows(await mgrDong.client.from("advances").delete().eq("id", await advance(DONG, "pending")).select("id")), "site manager own pending").toBe(1);
      expect(rows(await mgrDong.client.from("advances").delete().eq("id", await advance(DONG, "paid")).select("id")), "site manager own paid").toBe(0);
      expect(rows(await mgrDong.client.from("advances").delete().eq("id", await advance(NS, "pending")).select("id")), "site manager foreign").toBe(0);
      expect(rows(await acctDong.client.from("advances").delete().eq("id", await advance(DONG, "pending")).select("id")), "accountant: unchanged, no delete").toBe(0);
    });
  });

  // ── advance_deductions UPDATE ──────────────────────────────────────────────
  describe("advance_deductions UPDATE honours the debt guard", () => {
    async function supplierWithDebt(advanced: number, deductions: number[]) {
      const { data: s } = await adminClient().from("suppliers").insert({ name: `GMSI debt ${stamp} ${Math.random()}` }).select("id").single();
      const sup = s!.id as string;
      await advance(DONG, "paid", advanced, sup);
      const ids: string[] = [];
      for (const amount of deductions) {
        const { data, error } = await adminClient().from("advance_deductions").insert({
          supplier_id: sup, site_id: DONG, amount, recorded_by: owner.userId, kind: "advance",
        }).select("id").single();
        if (error) throw error;
        ids.push(data!.id as string);
      }
      return { sup, ids };
    }
    const debt = async (sup: string) => Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: sup })).data);

    it("9/10/11. beyond debt refused; downward allowed; increase within debt allowed — on any site", async () => {
      const { sup, ids: [a] } = await supplierWithDebt(100000, [30000, 20000]); // debt 50,000
      expect(await debt(sup)).toBe(50000);
      const over = await gm.client.from("advance_deductions").update({ amount: 80001 }).eq("id", a).select("id");
      expect(over.error?.code).toBe("23514");
      expect(await debt(sup), "unchanged after refusal").toBe(50000);

      const down = await gm.client.from("advance_deductions").update({ amount: 10000 }).eq("id", a).select("id");
      expect(down.error).toBeNull();
      expect(rows(down)).toBe(1);
      expect(await debt(sup)).toBe(70000);

      // Room is the remaining debt PLUS this row's own amount: 70,000 + 10,000.
      const upToLimit = await gm.client.from("advance_deductions").update({ amount: 80000 }).eq("id", a).select("id");
      expect(upToLimit.error).toBeNull();
      expect(await debt(sup)).toBe(0);
      expect((await gm.client.from("advance_deductions").update({ amount: 80000.01 }).eq("id", a).select("id")).error?.code).toBe("23514");
    });

    it("moving a deduction to another supplier is checked against that supplier's debt", async () => {
      const { ids: [a] } = await supplierWithDebt(100000, [30000]);
      const { sup: poor } = await supplierWithDebt(10000, []);
      expect((await gm.client.from("advance_deductions").update({ supplier_id: poor }).eq("id", a).select("id")).error?.code).toBe("23514");
    });

    it("site managers still have no UPDATE on deductions (unchanged)", async () => {
      const { ids: [a] } = await supplierWithDebt(100000, [30000]);
      expect(rows(await mgrDong.client.from("advance_deductions").update({ amount: 1 }).eq("id", a).select("id"))).toBe(0);
    });

    it("12 / C1. two concurrent increases that each fit but together exceed the debt: one loses, debt never negative", async () => {
      let oneWon = 0;
      for (let i = 0; i < REPEAT; i++) {
        // advanced 70,000, deducted 10,000 + 10,000 -> debt 50,000; each row may
        // reach 60,000 alone, but both at 50,000 would deduct 100,000.
        const { sup, ids: [a, b] } = await supplierWithDebt(70000, [10000, 10000]);
        const [ra, rb] = await Promise.all([
          gm.client.from("advance_deductions").update({ amount: 50000 }).eq("id", a).select("id"),
          gm2.client.from("advance_deductions").update({ amount: 50000 }).eq("id", b).select("id"),
        ]);
        const wins = [ra, rb].filter((r) => r.error === null && (r.data ?? []).length === 1).length;
        expect(wins, `round ${i}: exactly one increase lands`).toBe(1);
        expect([ra, rb].find((r) => r.error)?.error?.code).toBe("23514");
        expect(await debt(sup), `round ${i}: debt`).toBe(10000);
        oneWon++;
      }
      expect(oneWon).toBe(REPEAT);
    });
  });

  // ── C2: a line edit cannot race the payment that stocks its batch ──────────
  it("C2. GM weight edit racing the full payment never leaves stock written from different figures", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const visitId = await visit(DONG, "awaiting_price_approval");
      const lineId = await line(visitId);
      expect((await owner.client.rpc("approve_pricing", { p_visit_id: visitId })).error).toBeNull();
      const { data: st } = await adminClient().from("batch_settlements").select("id, net_balance").eq("visit_id", visitId).single();
      const [pay, edit] = await Promise.all([
        acctDong.client.rpc("record_settlement_payment", { p_settlement_id: st!.id, p_amount: Number(st!.net_balance), p_method: "transfer" }),
        gm.client.from("visit_materials").update({ weight_kg: 5 }).eq("id", lineId).select("id"),
      ]);
      expect(pay.error, `round ${i}: payment`).toBeNull();
      // 0158: the batch already has an approved settlement, so the edit is refused
      // outright (SF002) unless it meets the payment holding the lock (VM002).
      if (edit.error) expect(["VM001", "VM002", "SF002"]).toContain(edit.error.code);
      const after = await batchState(visitId, lineId);
      expect(after.v!.state).toBe("stocked");
      expect(Number(after.lot!.weight_kg), `round ${i}: lot matches the committed line`).toBe(Number(after.l!.weight_kg));
    }
  });
});
