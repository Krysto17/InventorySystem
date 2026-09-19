import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs, approveCostRunAs } from "../setup/approvals";

/**
 * 0161 — Phase 3F-T6: F-07 deduction delete, F-08 reverse_paid_supply, F-10
 * inventory expense site scope.
 *
 * F-07. 0158 (SF004) already freezes a deduction whose own visit carries a
 * settlement. What it cannot see is the supplier-level snapshot: a settlement's
 * remaining_debt is written from supplier_outstanding_debt(), which subtracts
 * every advance-kind deduction of that supplier — standalone rows included — and
 * SF001 freezes it. AD001 refuses deleting a deduction once such a snapshot has
 * been taken; before that, deletion is unchanged.
 *
 * F-08. Reversal now locks the settlement, then the buckets, then the lots
 * (0153/0155/0160 order), re-checks eligibility under those locks, and refuses
 * (RS001) when the intake is backing stock already taken out of the bucket.
 *
 * F-10. Inventory writes expenses on its own site only; owner, GM and general
 * accountant keep their deliberate cross-site authority, and inventory's
 * cross-site READ (0154) is untouched.
 */
describe("financial and stock integrity guards (0161)", () => {
  const stamp = Date.now().toString(36);
  const REPEAT = 4;
  const DEADLOCK = "40P01";
  let dong: string, oldSite: string, newSite: string, mat: string, sup: string;
  let owner: TestUser, acct: TestUser, gm: TestUser, invDong: TestUser, invOld: TestUser, mgrDong: TestUser, gate: TestUser;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    dong = sites!.find((s) => s.name === "Dong")!.id as string;
    oldSite = sites!.find((s) => s.name === "Old-Site")!.id as string;
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    mat = (await admin.from("material_types").insert({ name: `T6 ${stamp}` }).select("id").single()).data!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `T6 supplier ${stamp}` }).select("id").single()).data!.id as string;
    owner = await makeUser({ username: `t6-owner-${stamp}`, role: "owner", siteId: null });
    acct = await makeUser({ username: `t6-acct-${stamp}`, role: "accounting", siteId: dong });
    gm = await makeUser({ username: `t6-gm-${stamp}`, role: "manager", siteId: newSite });
    invDong = await makeUser({ username: `t6-invd-${stamp}`, role: "inventory", siteId: dong });
    invOld = await makeUser({ username: `t6-invo-${stamp}`, role: "inventory", siteId: oldSite });
    mgrDong = await makeUser({ username: `t6-mgrd-${stamp}`, role: "manager", siteId: dong });
    gate = await makeUser({ username: `t6-gate-${stamp}`, role: "gate", siteId: dong });
  });

  // ── fixtures ───────────────────────────────────────────────────────────────
  async function paidAdvance(amount: number, supplier = sup) {
    const { error } = await adminClient().from("advances").insert({
      supplier_id: supplier, site_id: dong, purpose: `T6 ${stamp} ${Math.random()}`,
      amount_naira: amount, approval_status: "paid", approved_by: owner.userId,
      approved_at: new Date().toISOString(), recorded_by: acct.userId,
    });
    expect(error, `advance fixture: ${error?.message}`).toBeNull();
  }
  const debt = async (supplier = sup) =>
    Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplier } as never)).data);
  async function deduction(amount: number, visitId: string | null, supplier = sup, kind = "advance") {
    const { data, error } = await adminClient().from("advance_deductions").insert({
      supplier_id: supplier, site_id: dong, ref_visit_id: visitId, amount, kind, recorded_by: acct.userId,
    }).select("id").single();
    expect(error, `deduction fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  }
  // A visit priced and waiting for the owner.
  async function visit(kg = 100, price = 10, supplier = sup) {
    const admin = adminClient();
    const { data: v, error } = await admin.from("visits").insert({
      site_id: dong, supplier_id: supplier, declared_material_type_id: mat,
      entry_path: "processed", state: "awaiting_price_approval", created_by: owner.userId,
    }).select("id").single();
    expect(error, `visit fixture: ${error?.message}`).toBeNull();
    expect((await admin.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: mat, weight_kg: kg, unit_price: price, requires_analysis: false,
    })).error).toBeNull();
    return v!.id as string;
  }
  // 0162: approval names the pricing version reviewed.
  const approvePricing = (visitId: string) => approvePricingAs(owner.client, visitId);
  const settlementOf = async (visitId: string) =>
    (await adminClient().from("batch_settlements").select("id, status, remaining_debt").eq("visit_id", visitId).maybeSingle()).data;
  // A paid supply: priced → approved → paid → lots + purchase_intake movement.
  async function paidSupply(kg = 100, price = 10, supplier = sup) {
    const v = await visit(kg, price, supplier);
    expect((await approvePricing(v)).error, "approve").toBeNull();
    const s = await settlementOf(v);
    const pay = await acct.client.rpc("record_settlement_payment", { p_settlement_id: s!.id, p_amount: kg * price, p_method: "transfer", p_request_key: crypto.randomUUID() } as never);
    expect(pay.error, `payment: ${pay.error?.message}`).toBeNull();
    return v;
  }
  const lotsOf = async (visitId: string) =>
    (await adminClient().from("stock_lots").select("id, status")
      .in("ref_visit_material_id",
        ((await adminClient().from("visit_materials").select("id").eq("visit_id", visitId)).data ?? []).map((m) => m.id as string))).data ?? [];
  const bucket = async () => {
    const { data } = await adminClient().from("stock_movements").select("weight, direction")
      .eq("site_id", dong).eq("material_type_id", mat);
    return (data ?? []).reduce((s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)), 0);
  };
  const reverse = (visitId: string, who: TestUser = acct) =>
    who.client.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: "refund confirmed" } as never);
  const stateOf = async (visitId: string) =>
    (await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state as string;
  async function supplySnapshot(visitId: string) {
    const admin = adminClient();
    const lots = await lotsOf(visitId);
    const moves = (await admin.from("stock_movements").select("id, weight, direction, reason").eq("ref_visit_id", visitId).order("id")).data;
    const settle = (await admin.from("batch_settlements").select("*").eq("visit_id", visitId)).data;
    const pays = (await admin.from("settlement_payments").select("*")
      .in("settlement_id", (settle ?? []).map((s) => s.id as string)).order("id")).data;
    return JSON.stringify({ lots, moves, settle, pays, state: await stateOf(visitId), bucket: await bucket() });
  }
  async function expense(siteId: string, by: TestUser, status = "pending") {
    const { data, error } = await adminClient().from("consumables").insert({
      site_id: siteId, name: `T6 expense ${stamp} ${Math.random()}`, category: "fuel_lubricants",
      amount_naira: 5000, recorded_by: by.userId, approval_status: status,
    }).select("id").single();
    expect(error, `expense fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  }

  // ── F-07 ───────────────────────────────────────────────────────────────────
  it("1. a deduction captured by a finalized settlement snapshot cannot be deleted", async () => {
    const s2 = (await adminClient().from("suppliers").insert({ name: `T6 f07 ${stamp}` }).select("id").single()).data!.id as string;
    await paidAdvance(100_000, s2);
    const d = await deduction(10_000, null, s2);          // standalone recovery
    expect(await debt(s2)).toBe(90_000);
    const v = await visit(100, 10, s2);
    expect((await approvePricing(v)).error).toBeNull();    // freezes remaining_debt = 90,000
    expect(Number((await settlementOf(v))!.remaining_debt)).toBe(90_000);

    const res = await acct.client.from("advance_deductions").delete().eq("id", d).select("id");
    expect(res.error?.code).toBe("AD001");
    expect(res.error!.message).toBe("This deduction has already been used in finalized accounts and cannot be deleted.");
    expect(await debt(s2), "6. the debt is untouched").toBe(90_000);
    expect((await adminClient().from("advance_deductions").select("id").eq("id", d)).data).toHaveLength(1);
  });

  it("2. a deduction recorded before any snapshot is still deletable", async () => {
    const s2 = (await adminClient().from("suppliers").insert({ name: `T6 f07b ${stamp}` }).select("id").single()).data!.id as string;
    await paidAdvance(50_000, s2);
    const d = await deduction(5_000, null, s2);
    expect(await debt(s2)).toBe(45_000);
    const res = await acct.client.from("advance_deductions").delete().eq("id", d).select("id");
    expect(res.error, `${res.error?.message}`).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(await debt(s2)).toBe(50_000);

    // A visit-linked deduction with no settlement yet is unchanged too.
    const v = await visit(10, 10, s2);
    const d2 = await deduction(1_000, v, s2);
    expect((await acct.client.from("advance_deductions").delete().eq("id", d2).select("id")).data).toHaveLength(1);
  });

  it("3-5. owner, GM and the service role cannot bypass AD001", async () => {
    const s2 = (await adminClient().from("suppliers").insert({ name: `T6 f07c ${stamp}` }).select("id").single()).data!.id as string;
    await paidAdvance(80_000, s2);
    const d = await deduction(8_000, null, s2);
    const v = await visit(50, 10, s2);
    expect((await approvePricing(v)).error).toBeNull();

    for (const [who, client] of [["owner", owner.client], ["gm", gm.client], ["service role", adminClient()]] as const) {
      const res = await client.from("advance_deductions").delete().eq("id", d).select("id");
      expect(res.error?.code, `${who}: ${res.error?.message}`).toBe("AD001");
    }
    expect(await debt(s2)).toBe(72_000);
    expect((await adminClient().from("advance_deductions").select("id").eq("id", d)).data).toHaveLength(1);
  });

  it("0158 still answers for a deduction on its own settled visit (SF004, not duplicated)", async () => {
    const s2 = (await adminClient().from("suppliers").insert({ name: `T6 f07d ${stamp}` }).select("id").single()).data!.id as string;
    await paidAdvance(60_000, s2);
    const v = await visit(100, 10, s2);
    const d = await deduction(5_000, v, s2);
    expect((await approvePricing(v)).error).toBeNull();
    const res = await acct.client.from("advance_deductions").delete().eq("id", d).select("id");
    expect(res.error?.code).toBe("SF004");
  });

  // ── F-08 ───────────────────────────────────────────────────────────────────
  it("7. an unused paid supply still reverses", async () => {
    const v = await paidSupply(40, 10);
    const before = await bucket();
    expect((await lotsOf(v)).every((l) => l.status === "available")).toBe(true);
    const res = await reverse(v);
    expect(res.error, `${res.error?.message}`).toBeNull();
    expect(await lotsOf(v)).toHaveLength(0);
    expect(await bucket()).toBe(before - 40);
    expect(await stateOf(v)).toBe("pricing");
    expect(await settlementOf(v)).toBeNull();
  });

  it("8. a sold lot blocks reversal (approved cost-price run)", async () => {
    const v = await paidSupply(30, 10);
    const [lot] = await lotsOf(v);
    const { data: run } = await invDong.client.from("cost_price_runs").insert({
      site_id: dong, label: `T6 run ${stamp} ${Math.random()}`, material_type_id: mat,
      approval_status: "pending", created_by: invDong.userId,
    }).select("id").single();
    expect((await invDong.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot.id })).error).toBeNull();
    expect((await approveCostRunAs(owner.client, run!.id as string)).error).toBeNull();

    const before = await supplySnapshot(v);
    const res = await reverse(v);
    expect(res.error?.code).toBe("RS001");
    expect(await supplySnapshot(v), "13. nothing changed").toBe(before);
  });

  it("9. a released lot blocks reversal", async () => {
    const v = await paidSupply(25, 10);
    const [lot] = await lotsOf(v);
    const { data: pass } = await adminClient().from("gate_passes").insert({
      site_id: dong, material_type_id: mat, reason: `T6 ${stamp}`, status: "issued", issued_by: mgrDong.userId, stock_lot_id: lot.id,
    }).select("id").single();
    expect((await gate.client.from("gate_passes").update({ status: "acknowledged" }).eq("id", pass!.id).select("id")).error).toBeNull();

    const before = await supplySnapshot(v);
    const res = await reverse(v);
    expect(res.error?.code).toBe("RS001");
    expect(await supplySnapshot(v)).toBe(before);
  });

  it("10. a live gate pass blocks reversal", async () => {
    const v = await paidSupply(20, 10);
    const [lot] = await lotsOf(v);
    expect((await adminClient().from("gate_passes").insert({
      site_id: dong, material_type_id: mat, reason: `T6 ${stamp}`, status: "issued", issued_by: mgrDong.userId, stock_lot_id: lot.id,
    })).error).toBeNull();

    const before = await supplySnapshot(v);
    expect((await reverse(v)).error?.code).toBe("RS001");
    expect(await supplySnapshot(v)).toBe(before);
    expect((await lotsOf(v))[0].status, "the lot is still in stock").toBe("available");
  });

  it("11-12. a pending cost-price reservation and an approved run both block reversal", async () => {
    // pending reservation (0160 CP003 reserves it for that draft)
    const v = await paidSupply(15, 10);
    const [lot] = await lotsOf(v);
    const { data: run } = await invDong.client.from("cost_price_runs").insert({
      site_id: dong, label: `T6 pend ${stamp} ${Math.random()}`, material_type_id: mat,
      approval_status: "pending", created_by: invDong.userId,
    }).select("id").single();
    expect((await invDong.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot.id })).error).toBeNull();

    const before = await supplySnapshot(v);
    expect((await reverse(v)).error?.code).toBe("RS001");
    expect(await supplySnapshot(v)).toBe(before);
    expect((await lotsOf(v))[0].status).toBe("available");
    // (the approved case is pinned by test 8)
  });

  it("F-08. the intake that is backing stock already taken out cannot be reversed; the bucket never goes negative", async () => {
    const v = await paidSupply(100, 10);           // 100 kg in, lots available
    const other = await paidSupply(50, 10);        // 50 kg more in the same bucket
    const [otherLot] = await lotsOf(other);
    // the other 50 kg is mixed and sold through an approved run
    const { data: run } = await invDong.client.from("cost_price_runs").insert({
      site_id: dong, label: `T6 mix ${stamp} ${Math.random()}`, material_type_id: mat,
      approval_status: "pending", created_by: invDong.userId,
    }).select("id").single();
    await invDong.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: otherLot.id });
    expect((await approveCostRunAs(owner.client, run!.id as string)).error).toBeNull();
    // and a bulk sale takes 90 kg more — backed by the first supply's intake
    expect((await adminClient().from("stock_movements").insert({
      site_id: dong, material_type_id: mat, weight: 90, direction: "out", recorded_by: owner.userId, reason: "bulk_sale",
    })).error).toBeNull();

    const before = await supplySnapshot(v);
    const bucketBefore = await bucket();
    expect((await lotsOf(v)).every((l) => l.status === "available"), "this visit's own lots are untouched").toBe(true);

    const res = await reverse(v);
    expect(res.error?.code, "the lot check alone would have allowed this").toBe("RS001");
    expect(await supplySnapshot(v)).toBe(before);
    expect(await bucket()).toBe(bucketBefore);
    expect(await bucket(), "17. the bucket is never negative").toBeGreaterThanOrEqual(0);
    expect(await stateOf(v)).toBe("stocked");
  });

  it("14. reversal vs a competing sale of the same lot: exactly one wins, no deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const v = await paidSupply(10, 10);
      const [lot] = await lotsOf(v);
      const { data: run } = await invDong.client.from("cost_price_runs").insert({
        site_id: dong, label: `T6 race ${stamp} ${i} ${Math.random()}`, material_type_id: mat,
        approval_status: "pending", created_by: invDong.userId,
      }).select("id").single();
      expect((await invDong.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot.id })).error).toBeNull();

      const [rev, sale] = await Promise.all([
        reverse(v),
        approveCostRunAs(owner.client, run!.id as string),
      ]);
      expect(rev.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(sale.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      // The lot is reserved by a pending run either way, so the reversal is refused.
      expect(rev.error?.code, `iteration ${i}: reversal refused`).toBe("RS001");
      // 0162: the sale either lands on the run the owner read, or is refused
      // because the reversal touched the lot in between. Both are correct; what
      // must never happen is a sale of a run nobody reviewed.
      if (sale.error) {
        expect(sale.error.code, `iteration ${i}: only staleness may refuse the sale`).toBe("ST001");
        expect((await lotsOf(v))[0].status, `iteration ${i}`).toBe("available");
      } else {
        expect((await lotsOf(v))[0].status).toBe("sold");
      }
      expect(await bucket(), `iteration ${i}`).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("15. reversal vs gate release of the same lot: exactly one wins, no deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const v = await paidSupply(10, 10);
      const [lot] = await lotsOf(v);
      const { data: pass } = await adminClient().from("gate_passes").insert({
        site_id: dong, material_type_id: mat, reason: `T6 gate ${stamp} ${i}`, status: "issued", issued_by: mgrDong.userId, stock_lot_id: lot.id,
      }).select("id").single();

      const [rev, ack] = await Promise.all([
        reverse(v),
        gate.client.from("gate_passes").update({ status: "acknowledged" }).eq("id", pass!.id).select("id"),
      ]);
      expect(rev.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(ack.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(rev.error?.code, `iteration ${i}: the live pass refuses the reversal`).toBe("RS001");
      expect(ack.error, `iteration ${i}: the release goes through`).toBeNull();
      expect((await lotsOf(v))[0].status).toBe("released");
      const releases = (await adminClient().from("stock_movements").select("id", { count: "exact", head: true })
        .eq("gate_pass_id", pass!.id).eq("reason", "gate_release")).count;
      expect(releases, `iteration ${i}: exactly one deduction`).toBe(1);
      expect(await bucket()).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("16. reversal vs a competing pending reservation of its lot: no deadlock, no reversed-but-reserved lot", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const v = await paidSupply(10, 10);
      const [lot] = await lotsOf(v);
      const { data: run } = await invDong.client.from("cost_price_runs").insert({
        site_id: dong, label: `T6 resv ${stamp} ${i} ${Math.random()}`, material_type_id: mat,
        approval_status: "pending", created_by: invDong.userId,
      }).select("id").single();

      const [rev, resv] = await Promise.all([
        reverse(v),
        invDong.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot.id }),
      ]);
      for (const r of [rev, resv]) expect(r.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      const links = (await adminClient().from("cost_price_run_lots").select("run_id").eq("stock_lot_id", lot.id)).data ?? [];
      if (!rev.error) {
        // the reversal won: the lot is gone, so no reservation can point at it
        expect(links, `iteration ${i}: no reservation against reversed stock`).toHaveLength(0);
        expect(await lotsOf(v)).toHaveLength(0);
      } else {
        expect(rev.error.code, `iteration ${i}`).toBe("RS001");
        expect(await lotsOf(v), `iteration ${i}: the supply is intact`).toHaveLength(1);
      }
      expect(await bucket()).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  // ── F-10 ───────────────────────────────────────────────────────────────────
  it("18. inventory writes expenses on its own site", async () => {
    const ins = await invDong.client.from("consumables").insert({
      site_id: dong, name: `T6 own ${stamp} ${Math.random()}`, category: "fuel_lubricants",
      amount_naira: 1000, recorded_by: invDong.userId, approval_status: "pending",
    }).select("id").single();
    expect(ins.error, `${ins.error?.message}`).toBeNull();
    expect((await invDong.client.from("consumables").update({ comment: "own site" }).eq("id", ins.data!.id).select("id")).data).toHaveLength(1);
    expect((await invDong.client.from("consumables").delete().eq("id", ins.data!.id).select("id")).data).toHaveLength(1);
  });

  it("19-21. inventory at Old-Site cannot insert, edit or delete a Dong expense", async () => {
    const e = await expense(dong, mgrDong);
    const before = JSON.stringify((await adminClient().from("consumables").select("*").eq("id", e).single()).data);

    const ins = await invOld.client.from("consumables").insert({
      site_id: dong, name: `T6 foreign ${stamp}`, category: "fuel_lubricants",
      amount_naira: 1000, recorded_by: invOld.userId, approval_status: "pending",
    });
    expect(ins.error?.code, "19. foreign-site INSERT").toBe("42501");
    expect((await invOld.client.from("consumables").update({ comment: "hijacked" }).eq("id", e).select("id")).data ?? [], "20. foreign-site UPDATE").toHaveLength(0);
    expect((await invOld.client.from("consumables").delete().eq("id", e).select("id")).data ?? [], "21. foreign-site DELETE").toHaveLength(0);

    expect(JSON.stringify((await adminClient().from("consumables").select("*").eq("id", e).single()).data)).toBe(before);
    // Reading across sites is unchanged (0154).
    expect((await invOld.client.from("consumables").select("id").eq("id", e)).data ?? []).toHaveLength(1);
  });

  it("22-23. GM cross-site, site manager, accounting and owner authority are unchanged", async () => {
    const e = await expense(dong, mgrDong);
    expect((await gm.client.from("consumables").update({ comment: "gm cross-site" }).eq("id", e).select("id")).data, "22. GM").toHaveLength(1);
    expect((await mgrDong.client.from("consumables").update({ comment: "site manager" }).eq("id", e).select("id")).data).toHaveLength(1);
    expect((await acct.client.from("consumables").update({ comment: "accounting own site" }).eq("id", e).select("id")).data).toHaveLength(1);
    expect((await owner.client.from("consumables").update({ comment: "owner" }).eq("id", e).select("id")).data).toHaveLength(1);
    // A manager at another site still cannot.
    expect((await gm.client.from("consumables").select("id").eq("id", e)).data).toHaveLength(1);
    expect((await owner.client.from("consumables").delete().eq("id", e).select("id")).data).toHaveLength(1);
  });
});
