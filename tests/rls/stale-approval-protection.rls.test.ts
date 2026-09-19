import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { reviewExpenseAs, reviewAdvanceAs, approvePricingAs, approveCostRunAs } from "../setup/approvals";

/**
 * 0162 — Phase 3F-T7: F-09 stale approval protection.
 *
 * An approval used to commit against whatever the row said at the instant the
 * button was pressed, not the version the approver had read. Reproduced on
 * 0161: the owner reviewed a ₦5,000 expense, inventory edited it to ₦500,000
 * while the owner was deciding, and the approval landed on ₦500,000 — which was
 * then paid. Advances behaved the same way and turned into supplier debt.
 *
 * Both tables now carry an integer `revision`, bumped by a BEFORE UPDATE
 * trigger on every update whoever makes it. The decision names the revision it
 * reviewed; the RPC locks the row, proves it is still pending and still at that
 * revision, and only then writes. A mismatch is ST001 and changes nothing.
 *
 * The check lives in the database, not the action: a pending → approved/rejected
 * transition requires a transaction-local token carrying the reviewed revision,
 * and only the review RPCs set it — so a direct PostgREST table UPDATE cannot
 * approve anything, with or without a revision filter.
 */
describe("stale approval protection (0162)", () => {
  const stamp = Date.now().toString(36);
  const STALE = "ST001";
  const DEADLOCK = "40P01";
  let dong: string, sup: string;
  let owner: TestUser, owner2: TestUser, inv: TestUser, mgr: TestUser, acct: TestUser;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    dong = sites!.find((s) => s.name === "Dong")!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `T7 supplier ${stamp}` }).select("id").single()).data!.id as string;
    owner = await makeUser({ username: `t7-owner-${stamp}`, role: "owner", siteId: null });
    owner2 = await makeUser({ username: `t7-owner2-${stamp}`, role: "owner", siteId: null });
    inv = await makeUser({ username: `t7-inv-${stamp}`, role: "inventory", siteId: dong });
    mgr = await makeUser({ username: `t7-mgr-${stamp}`, role: "manager", siteId: dong });
    acct = await makeUser({ username: `t7-acct-${stamp}`, role: "accounting", siteId: dong });
  });

  // a pending expense, and the version the owner would be looking at
  async function expense(amount = 5000) {
    const { data } = await adminClient().from("consumables").insert({
      site_id: dong, name: `T7 expense ${stamp} ${Math.random()}`, category: "fuel_lubricants",
      amount_naira: amount, recorded_by: inv.id, approval_status: "pending",
    }).select("id, revision, amount_naira").single();
    return data as { id: string; revision: number; amount_naira: number };
  }

  async function advance(amount = 10000) {
    const { data } = await adminClient().from("advances").insert({
      supplier_id: sup, site_id: dong, purpose: `T7 advance ${stamp} ${Math.random()}`,
      amount_naira: amount, recorded_by: mgr.id, approval_status: "pending",
    }).select("id, revision, amount_naira").single();
    return data as { id: string; revision: number; amount_naira: number };
  }

  const reviewExpense = (u: TestUser, id: string, rev: number, decision = "approved") =>
    u.client.rpc("review_expense", { p_id: id, p_reviewed_revision: rev, p_decision: decision });
  const reviewAdvance = (u: TestUser, id: string, rev: number, decision = "approved") =>
    u.client.rpc("review_advance", { p_id: id, p_reviewed_revision: rev, p_decision: decision });

  const readExpense = async (id: string) =>
    (await adminClient().from("consumables").select("approval_status, amount_naira, revision").eq("id", id).single()).data!;
  const readAdvance = async (id: string) =>
    (await adminClient().from("advances").select("approval_status, amount_naira, revision").eq("id", id).single()).data!;

  // ── Expense ───────────────────────────────────────────────────────────────

  it("1. a stale expense approval is refused and changes nothing", async () => {
    const e = await expense(5000);
    // inventory edits it while the owner is deciding
    expect((await inv.client.from("consumables").update({ amount_naira: 500000 })
      .eq("id", e.id).select("id")).data).toHaveLength(1);

    const res = await reviewExpense(owner, e.id, e.revision);
    expect(res.error?.code, "the reviewed version is gone").toBe(STALE);

    const after = await readExpense(e.id);
    expect(after.approval_status, "still pending").toBe("pending");
    expect(Number(after.amount_naira)).toBe(500000);
  });

  it("2. a fresh expense approval succeeds", async () => {
    const e = await expense(4000);
    expect((await reviewExpense(owner, e.id, e.revision)).error).toBeNull();
    const after = await readExpense(e.id);
    expect(after.approval_status).toBe("approved");
    expect(Number(after.amount_naira), "the amount the owner reviewed").toBe(4000);
  });

  it("3. rejection is version-checked too", async () => {
    const stale = await expense(3000);
    await inv.client.from("consumables").update({ amount_naira: 300000 }).eq("id", stale.id).select("id");
    expect((await reviewExpense(owner, stale.id, stale.revision, "rejected")).error?.code).toBe(STALE);
    expect((await readExpense(stale.id)).approval_status).toBe("pending");

    const fresh = await expense(3000);
    expect((await reviewExpense(owner, fresh.id, fresh.revision, "rejected")).error).toBeNull();
    expect((await readExpense(fresh.id)).approval_status).toBe("rejected");
  });

  it("4. every update moves the revision, whoever makes it", async () => {
    const e = await expense(1000);
    expect(e.revision).toBe(1);
    await inv.client.from("consumables").update({ comment: "note" }).eq("id", e.id).select("id");
    expect((await readExpense(e.id)).revision).toBe(2);
    // a service-role write is not exempt
    await adminClient().from("consumables").update({ comment: "admin note" }).eq("id", e.id);
    expect((await readExpense(e.id)).revision).toBe(3);
  });

  // ── Advance ───────────────────────────────────────────────────────────────

  it("5. a stale advance approval is refused, and creates no supplier debt", async () => {
    const a = await advance(10000);
    const before = (await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: sup })).data;
    expect((await mgr.client.from("advances").update({ amount_naira: 900000 })
      .eq("id", a.id).select("id")).data).toHaveLength(1);

    expect((await reviewAdvance(owner, a.id, a.revision)).error?.code).toBe(STALE);

    const after = await readAdvance(a.id);
    expect(after.approval_status).toBe("pending");
    expect((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: sup })).data,
      "debt untouched by a refused approval").toBe(before);
  });

  it("6. a fresh advance approval succeeds", async () => {
    const a = await advance(7000);
    expect((await reviewAdvance(owner, a.id, a.revision)).error).toBeNull();
    const after = await readAdvance(a.id);
    expect(after.approval_status).toBe("approved");
    expect(Number(after.amount_naira)).toBe(7000);
  });

  // ── Direct API / RPC bypass ───────────────────────────────────────────────

  it("7. a direct table UPDATE cannot approve — with or without a revision filter", async () => {
    for (const [label, build] of [
      ["no filter", (id: string) => owner.client.from("consumables").update({ approval_status: "approved" }).eq("id", id)],
      ["stale filter", (id: string, rev: number) => owner.client.from("consumables")
        .update({ approval_status: "approved" }).eq("id", id).eq("revision", rev)],
    ] as const) {
      const e = await expense(2000);
      const res = await build(e.id, e.revision).select("id");
      expect(res.error?.code, `expense, ${label}`).toBe(STALE);
      expect((await readExpense(e.id)).approval_status, `expense, ${label}`).toBe("pending");
    }

    const a = await advance(2000);
    const res = await owner.client.from("advances").update({ approval_status: "approved" }).eq("id", a.id).select("id");
    expect(res.error?.code, "advance direct update").toBe(STALE);
    expect((await readAdvance(a.id)).approval_status).toBe("pending");
  });

  it("8. the service role cannot bypass the version check either", async () => {
    const e = await expense(2500);
    const res = await adminClient().from("consumables").update({ approval_status: "approved" }).eq("id", e.id).select("id");
    expect(res.error?.code).toBe(STALE);
    expect((await readExpense(e.id)).approval_status).toBe("pending");
  });

  it("9. a non-owner still cannot approve, and gets the role refusal, not ST001", async () => {
    const e = await expense();
    for (const [who, u] of [["inventory", inv], ["manager", mgr], ["accounting", acct]] as const) {
      const res = await reviewExpense(u, e.id, e.revision);
      expect(res.error, `${who} must be refused`).not.toBeNull();
      expect(res.error?.code, `${who} sees the role error, not a staleness one`).not.toBe(STALE);
    }
    expect((await readExpense(e.id)).approval_status).toBe("pending");

    const a = await advance();
    for (const u of [inv, mgr, acct]) {
      expect((await reviewAdvance(u, a.id, a.revision)).error).not.toBeNull();
    }
    expect((await readAdvance(a.id)).approval_status).toBe("pending");
  });

  it("10. an already-ruled expense refuses a second decision", async () => {
    const e = await expense(1500);
    expect((await reviewExpense(owner, e.id, e.revision)).error).toBeNull();
    const after = await readExpense(e.id);
    // even naming the new revision, it is no longer pending
    expect((await reviewExpense(owner, e.id, after.revision)).error?.code).toBe(STALE);
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  it("11. edit first / approve second: the approval is refused, the row stays pending", async () => {
    for (let t = 1; t <= 3; t++) {
      const e = await expense(5000);
      const [edit, approve] = await Promise.all([
        inv.client.from("consumables").update({ amount_naira: 999000 }).eq("id", e.id).select("id"),
        (async () => { await new Promise((r) => setTimeout(r, 15)); return reviewExpense(owner, e.id, e.revision); })(),
      ]);
      expect(edit.data, `trial ${t}: the edit lands`).toHaveLength(1);
      expect(approve.error?.code, `trial ${t}: the stale approval is refused`).toBe(STALE);
      expect(approve.error?.code).not.toBe(DEADLOCK);
      const after = await readExpense(e.id);
      expect(after.approval_status, `trial ${t}`).toBe("pending");
      expect(Number(after.amount_naira), `trial ${t}`).toBe(999000);
    }
  });

  it("12. approve first / edit second: the approval stands and inventory can no longer edit", async () => {
    for (let t = 1; t <= 3; t++) {
      const e = await expense(5000);
      const approve = await reviewExpense(owner, e.id, e.revision);
      expect(approve.error, `trial ${t}`).toBeNull();
      // inventory may only edit a pending expense
      const edit = await inv.client.from("consumables").update({ amount_naira: 999000 }).eq("id", e.id).select("id");
      expect(edit.data ?? [], `trial ${t}: no edit after the ruling`).toHaveLength(0);
      const after = await readExpense(e.id);
      expect(after.approval_status).toBe("approved");
      expect(Number(after.amount_naira), `trial ${t}: the approved figure`).toBe(5000);
    }
  });

  it("13. two approvers on the same reviewed version: exactly one approval, no deadlock", async () => {
    for (let t = 1; t <= 3; t++) {
      const e = await expense(6000);
      const [a, b] = await Promise.all([
        reviewExpense(owner, e.id, e.revision),
        reviewExpense(owner2, e.id, e.revision),
      ]);
      for (const [name, r] of [["A", a], ["B", b]] as const) {
        expect(r.error?.code, `trial ${t}: ${name} must not deadlock`).not.toBe(DEADLOCK);
      }
      expect([a.error, b.error].filter((x) => x === null), `trial ${t}: exactly one approval`).toHaveLength(1);
      expect([a.error, b.error].filter((x) => x?.code === STALE), `trial ${t}: the loser is stale`).toHaveLength(1);
      expect((await readExpense(e.id)).approval_status).toBe("approved");
    }
  });

  it("14. two approvers on the same advance: one debt movement only", async () => {
    for (let t = 1; t <= 3; t++) {
      const adv = await advance(8000);
      const [a, b] = await Promise.all([
        reviewAdvance(owner, adv.id, adv.revision),
        reviewAdvance(owner2, adv.id, adv.revision),
      ]);
      for (const [name, r] of [["A", a], ["B", b]] as const) {
        expect(r.error?.code, `trial ${t}: ${name} must not deadlock`).not.toBe(DEADLOCK);
      }
      expect([a.error, b.error].filter((x) => x === null), `trial ${t}: exactly one approval`).toHaveLength(1);
      const after = await readAdvance(adv.id);
      expect(after.approval_status).toBe("approved");
      expect(Number(after.amount_naira)).toBe(8000);
    }
  });

  it("15. advance edit vs approve race: no debt from a version nobody approved", async () => {
    for (let t = 1; t <= 3; t++) {
      const adv = await advance(9000);
      const [edit, approve] = await Promise.all([
        mgr.client.from("advances").update({ amount_naira: 750000 }).eq("id", adv.id).select("id"),
        (async () => { await new Promise((r) => setTimeout(r, 15)); return reviewAdvance(owner, adv.id, adv.revision); })(),
      ]);
      expect(approve.error?.code, `trial ${t}`).not.toBe(DEADLOCK);
      if (edit.error) {
        // The approval got there first: ST002 then freezes the approved amount.
        expect(approve.error, `trial ${t}: the approval stands`).toBeNull();
        const after = await readAdvance(adv.id);
        expect(after.approval_status, `trial ${t}`).toBe("approved");
        expect(Number(after.amount_naira), `trial ${t}: the reviewed figure`).toBe(9000);
      } else {
        expect(edit.data, `trial ${t}`).toHaveLength(1);
        expect(approve.error?.code, `trial ${t}`).toBe(STALE);
        const after = await readAdvance(adv.id);
        expect(after.approval_status, `trial ${t}: nothing approved`).toBe("pending");
        expect(Number(after.amount_naira)).toBe(750000);
      }
    }
  });

  // ── The screens carry the token ───────────────────────────────────────────

  it("16. the advance list view exposes the revision the screen needs", async () => {
    const a = await advance(1200);
    const { data } = await adminClient().from("advance_list").select("id, revision, amount_naira").eq("id", a.id).single();
    expect(data!.revision).toBe(a.revision);
  });
});

/**
 * 0162 (extended) — the same stale-decision defect on the three larger surfaces:
 * an approved payable that stays editable until payment, pricing approval, and
 * cost-price approval. Each was reproduced on 0161 before this was written.
 */
describe("stale financial decision protection — approved payables, pricing, cost price (0162)", () => {
  const stamp = Date.now().toString(36);
  const STALE = "ST001";
  const FROZEN = "ST002";
  const DEADLOCK = "40P01";
  let dong: string, sup: string, mat: string;
  let owner: TestUser, inv: TestUser, mgr: TestUser;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    dong = sites!.find((s) => s.name === "Dong")!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `T7x supplier ${stamp}` }).select("id").single()).data!.id as string;
    mat = (await admin.from("material_types").insert({ name: `T7x ${stamp}` }).select("id").single()).data!.id as string;
    owner = await makeUser({ username: `t7x-owner-${stamp}`, role: "owner", siteId: null });
    inv = await makeUser({ username: `t7x-inv-${stamp}`, role: "inventory", siteId: dong });
    mgr = await makeUser({ username: `t7x-mgr-${stamp}`, role: "manager", siteId: dong });
  });

  const approvedExpense = async (amount = 5000) => {
    const { data } = await adminClient().from("consumables").insert({
      site_id: dong, name: `T7x exp ${stamp} ${Math.random()}`, category: "fuel_lubricants",
      amount_naira: amount, recorded_by: inv.id, approval_status: "pending",
    }).select("id, revision").single();
    const row = data as { id: string; revision: number };
    expect((await reviewExpenseAs(owner.client, row.id)).error).toBeNull();
    return row.id;
  };
  const approvedAdvance = async (amount = 10000) => {
    const { data } = await adminClient().from("advances").insert({
      supplier_id: sup, site_id: dong, purpose: `T7x adv ${stamp} ${Math.random()}`,
      amount_naira: amount, recorded_by: mgr.id, approval_status: "pending",
    }).select("id").single();
    const id = (data as { id: string }).id;
    expect((await reviewAdvanceAs(owner.client, id)).error).toBeNull();
    return id;
  };
  const expenseRow = async (id: string) =>
    (await adminClient().from("consumables").select("approval_status, amount_naira, comment").eq("id", id).single()).data!;
  const advanceRow = async (id: string) =>
    (await adminClient().from("advances").select("approval_status, amount_naira, purpose").eq("id", id).single()).data!;

  // ── 17-23. approved payables ──────────────────────────────────────────────

  it("17. an approved expense's financial content cannot be edited", async () => {
    const id = await approvedExpense(5000);
    for (const patch of [{ amount_naira: 500000 }, { site_id: dong === null ? dong : dong }, { category: "wages" }, { account_number: "9999999999" }]) {
      if ("site_id" in patch) continue;
      const res = await mgr.client.from("consumables").update(patch).eq("id", id).select("id");
      expect(res.error?.code, JSON.stringify(patch)).toBe(FROZEN);
    }
    expect(Number((await expenseRow(id)).amount_naira)).toBe(5000);
  });

  it("18. an approved advance's financial content cannot be edited", async () => {
    const id = await approvedAdvance(10000);
    for (const patch of [{ amount_naira: 900000 }, { account_name: "Someone Else" }, { bank_name: "Other Bank" }]) {
      const res = await mgr.client.from("advances").update(patch).eq("id", id).select("id");
      expect(res.error?.code, JSON.stringify(patch)).toBe(FROZEN);
    }
    expect(Number((await advanceRow(id)).amount_naira)).toBe(10000);
  });

  it("19. harmless metadata on an approved payable is still editable", async () => {
    const id = await approvedExpense(4000);
    expect((await mgr.client.from("consumables").update({ comment: "ok to pay" }).eq("id", id).select("id")).error).toBeNull();
    expect((await expenseRow(id)).comment).toBe("ok to pay");
    // the description is not money and not a payee
    expect((await mgr.client.from("consumables").update({ name: "Diesel (corrected)" }).eq("id", id).select("id")).error).toBeNull();

    const advId = await approvedAdvance(4000);
    expect((await mgr.client.from("advances").update({ purpose: "Float (corrected)" }).eq("id", advId).select("id")).error).toBeNull();
  });

  it("20. a paid expense carries exactly the approved amount", async () => {
    const id = await approvedExpense(5000);
    await mgr.client.from("consumables").update({ amount_naira: 500000 }).eq("id", id).select("id");
    expect((await mgr.client.from("consumables").update({ approval_status: "paid" })
      .eq("id", id).eq("approval_status", "approved").select("id")).error).toBeNull();
    const after = await expenseRow(id);
    expect(after.approval_status).toBe("paid");
    expect(Number(after.amount_naira), "cash released on the approved figure").toBe(5000);
  });

  it("21. a paid advance puts exactly the approved amount on the supplier's debt", async () => {
    const before = (await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: sup })).data;
    const id = await approvedAdvance(7000);
    await mgr.client.from("advances").update({ amount_naira: 900000 }).eq("id", id).select("id");
    expect((await mgr.client.from("advances").update({ approval_status: "paid" })
      .eq("id", id).eq("approval_status", "approved").select("id")).error).toBeNull();
    const after = (await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: sup })).data;
    expect(Number(after) - Number(before), "debt moved by the approved figure only").toBe(7000);
  });

  it("22-23. neither the owner nor the service role can bypass the approved freeze", async () => {
    const id = await approvedExpense(3000);
    expect((await owner.client.from("consumables").update({ amount_naira: 1 }).eq("id", id).select("id")).error?.code).toBe(FROZEN);
    expect((await adminClient().from("consumables").update({ amount_naira: 1 }).eq("id", id).select("id")).error?.code).toBe(FROZEN);
    expect(Number((await expenseRow(id)).amount_naira)).toBe(3000);

    const advId = await approvedAdvance(3000);
    expect((await owner.client.from("advances").update({ amount_naira: 1 }).eq("id", advId).select("id")).error?.code).toBe(FROZEN);
    expect((await adminClient().from("advances").update({ amount_naira: 1 }).eq("id", advId).select("id")).error?.code).toBe(FROZEN);
  });

  // ── 24-30. pricing ────────────────────────────────────────────────────────

  async function pricedVisit(weight = 100, price = 50) {
    const admin = adminClient();
    const { data: v } = await admin.from("visits").insert({
      site_id: dong, supplier_id: sup, declared_material_type_id: mat,
      entry_path: "processed", state: "awaiting_price_approval", created_by: owner.id,
    }).select("id").single();
    const visitId = (v as { id: string }).id;
    await admin.from("visit_materials").insert({
      visit_id: visitId, material_type_id: mat, weight_kg: weight, unit_price: price, requires_analysis: false,
    });
    return visitId;
  }
  const tokenFor = async (visitId: string) =>
    (await owner.client.rpc("pricing_review_token", { p_visit_id: visitId })).data as string;
  const settlementsFor = async (visitId: string) =>
    (await adminClient().from("batch_settlements").select("id, materials_total").eq("visit_id", visitId)).data ?? [];

  it("24. a stale pricing approval is refused and creates nothing", async () => {
    const visitId = await pricedVisit(100, 50);
    const reviewed = await tokenFor(visitId);
    expect((await mgr.client.from("visit_materials").update({ unit_price: 400 })
      .eq("visit_id", visitId).select("id")).data).toHaveLength(1);

    const res = await owner.client.rpc("approve_pricing", { p_visit_id: visitId, p_reviewed_token: reviewed });
    expect(res.error?.code).toBe(STALE);
    expect(await settlementsFor(visitId), "no settlement").toHaveLength(0);
    const { data: after } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(after!.state, "the batch did not move").toBe("awaiting_price_approval");
    const { data: lines } = await adminClient().from("visit_materials").select("price_finalized").eq("visit_id", visitId);
    expect(lines!.every((l) => !l.price_finalized), "no line was frozen").toBe(true);
  });

  it("25 + 30. a fresh pricing approval succeeds and snapshots exactly the reviewed version", async () => {
    const visitId = await pricedVisit(100, 50);
    expect((await approvePricingAs(owner.client, visitId)).error).toBeNull();
    const rows = await settlementsFor(visitId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].materials_total), "the reviewed 5,000").toBe(5000);
  });

  it("26. a versionless or wrong-token pricing approval cannot bypass", async () => {
    const visitId = await pricedVisit(20, 10);
    expect((await owner.client.rpc("approve_pricing",
      { p_visit_id: visitId, p_reviewed_token: "not-a-token" })).error?.code).toBe(STALE);
    expect((await owner.client.rpc("approve_pricing",
      { p_visit_id: visitId, p_reviewed_token: "" })).error?.code).toBe(STALE);
    expect(await settlementsFor(visitId)).toHaveLength(0);
  });

  it("27. edit first / approve second: refused, nothing written", async () => {
    for (let t = 1; t <= 3; t++) {
      const visitId = await pricedVisit(100, 50);
      const reviewed = await tokenFor(visitId);
      const [edit, approval] = await Promise.all([
        mgr.client.from("visit_materials").update({ unit_price: 900 }).eq("visit_id", visitId).select("id"),
        (async () => { await new Promise((r) => setTimeout(r, 15));
          return owner.client.rpc("approve_pricing", { p_visit_id: visitId, p_reviewed_token: reviewed }); })(),
      ]);
      expect(approval.error?.code, `trial ${t}`).not.toBe(DEADLOCK);
      expect(edit.error?.code, `trial ${t}`).not.toBe(DEADLOCK);
      if (edit.error) {
        // The approval got there first: 0157/0158 refuse the late line edit and
        // the settlement holds the reviewed figure.
        expect(approval.error, `trial ${t}: the approval stands`).toBeNull();
        const rows = await settlementsFor(visitId);
        expect(Number(rows[0].materials_total), `trial ${t}`).toBe(5000);
      } else {
        // The edit committed first, so the review is stale and nothing is written.
        expect(edit.data, `trial ${t}`).toHaveLength(1);
        expect(approval.error?.code, `trial ${t}`).toBe(STALE);
        expect(await settlementsFor(visitId), `trial ${t}`).toHaveLength(0);
      }
    }
  });

  it("28. approve first / edit second: the snapshot stands and the edit is refused", async () => {
    for (let t = 1; t <= 3; t++) {
      const visitId = await pricedVisit(100, 50);
      expect((await approvePricingAs(owner.client, visitId)).error, `trial ${t}`).toBeNull();
      const edit = await mgr.client.from("visit_materials").update({ unit_price: 900 }).eq("visit_id", visitId).select("id");
      expect(edit.error, `trial ${t}: 0158 freezes the lines`).not.toBeNull();
      const rows = await settlementsFor(visitId);
      expect(Number(rows[0].materials_total), `trial ${t}`).toBe(5000);
    }
  });

  it("29. a deduction or utility charge added after the review also invalidates it", async () => {
    const visitId = await pricedVisit(100, 50);
    const reviewed = await tokenFor(visitId);
    expect((await mgr.client.from("utility_charges").insert({
      visit_id: visitId, kind: "other", description: "late", amount: 250, recorded_by: mgr.id,
    }).select("id")).error).toBeNull();
    expect((await owner.client.rpc("approve_pricing",
      { p_visit_id: visitId, p_reviewed_token: reviewed })).error?.code).toBe(STALE);
    expect(await settlementsFor(visitId)).toHaveLength(0);
  });

  // ── 31-37. cost price ─────────────────────────────────────────────────────

  async function lotFor(kg: number, cost: number) {
    const admin = adminClient();
    await admin.from("stock_movements").insert({
      site_id: dong, material_type_id: mat, weight: kg, direction: "in",
      recorded_by: owner.id, reason: "purchase_intake",
    });
    const { data } = await admin.from("stock_lots").insert({
      site_id: dong, material_type_id: mat, weight_kg: kg, status: "available", cost_price_per_kg: cost,
    }).select("id").single();
    return (data as { id: string }).id;
  }
  async function pendingRun(lotIds: string[]) {
    const { data } = await inv.client.from("cost_price_runs").insert({
      site_id: dong, label: `T7x run ${stamp} ${Math.random()}`, material_type_id: mat,
      approval_status: "pending", created_by: inv.id,
    }).select("id").single();
    const runId = (data as { id: string }).id;
    for (const id of lotIds) {
      expect((await inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: id })).error).toBeNull();
    }
    return runId;
  }
  const runTokenFor = async (runId: string) =>
    (await owner.client.rpc("cost_price_review_token", { p_run_id: runId })).data as string;
  const runStatus = async (runId: string) =>
    (await adminClient().from("cost_price_runs").select("approval_status, sold").eq("id", runId).single()).data!;
  const lotStatus = async (lotId: string) =>
    (await adminClient().from("stock_lots").select("status").eq("id", lotId).single()).data!.status;

  it("31 + 34. a lot attached after the review blocks approval, and nothing is sold", async () => {
    const a = await lotFor(100, 10);
    const runId = await pendingRun([a]);
    const reviewed = await runTokenFor(runId);
    const b = await lotFor(900, 99);
    expect((await inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: b })).error).toBeNull();

    const res = await owner.client.rpc("approve_cost_price_run", { p_run_id: runId, p_reviewed_token: reviewed });
    expect(res.error?.code).toBe(STALE);
    const run = await runStatus(runId);
    expect(run.approval_status, "still pending").toBe("pending");
    expect(run.sold).toBe(false);
    expect(await lotStatus(a), "nothing sold").toBe("available");
    expect(await lotStatus(b)).toBe("available");
  });

  it("32. an extra changed after the review blocks approval", async () => {
    const runId = await pendingRun([await lotFor(50, 10)]);
    const reviewed = await runTokenFor(runId);
    expect((await inv.client.from("cost_price_run_extras").insert({
      run_id: runId, material_name: "late extra", weight_kg: 10, cost_price_per_kg: 40,
    }).select("id")).error).toBeNull();
    expect((await owner.client.rpc("approve_cost_price_run",
      { p_run_id: runId, p_reviewed_token: reviewed })).error?.code).toBe(STALE);
    expect((await runStatus(runId)).approval_status).toBe("pending");
  });

  it("33. a fresh cost-price approval succeeds and sells the reviewed run", async () => {
    const lot = await lotFor(40, 10);
    const runId = await pendingRun([lot]);
    expect((await approveCostRunAs(owner.client, runId)).error).toBeNull();
    expect((await runStatus(runId)).approval_status).toBe("approved");
    expect(await lotStatus(lot)).toBe("sold");
  });

  it("35. membership edit first / approve second: refused, no sale", async () => {
    for (let t = 1; t <= 2; t++) {
      const a = await lotFor(30, 10);
      const runId = await pendingRun([a]);
      const reviewed = await runTokenFor(runId);
      const b = await lotFor(30, 20);
      const [attach, approval] = await Promise.all([
        inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: b }).select("run_id"),
        (async () => { await new Promise((r) => setTimeout(r, 15));
          return owner.client.rpc("approve_cost_price_run", { p_run_id: runId, p_reviewed_token: reviewed }); })(),
      ]);
      expect(attach.error, `trial ${t}`).toBeNull();
      expect(approval.error?.code, `trial ${t}`).toBe(STALE);
      expect(approval.error?.code).not.toBe(DEADLOCK);
      expect(await lotStatus(a), `trial ${t}`).toBe("available");
    }
  });

  it("36. approve first / membership edit second: 0160 refuses the late edit", async () => {
    const lot = await lotFor(25, 10);
    const runId = await pendingRun([lot]);
    expect((await approveCostRunAs(owner.client, runId)).error).toBeNull();
    const late = await inv.client.from("cost_price_run_lots")
      .insert({ run_id: runId, stock_lot_id: await lotFor(25, 10) }).select("run_id");
    expect(late.error, "CP001 keeps an approved run immutable").not.toBeNull();
  });

  it("37. CP002 and CP003 still answer alongside the version check", async () => {
    // CP003: a lot reserved by one pending run cannot join a second.
    const shared = await lotFor(15, 10);
    await pendingRun([shared]);
    const { data: other } = await inv.client.from("cost_price_runs").insert({
      site_id: dong, label: `T7x rival ${stamp}`, material_type_id: mat,
      approval_status: "pending", created_by: inv.id,
    }).select("id").single();
    expect((await inv.client.from("cost_price_run_lots")
      .insert({ run_id: (other as { id: string }).id, stock_lot_id: shared })).error?.code).toBe("CP003");

    // CP002: a lot that has left stock cannot be approved even with a fresh token.
    const sold = await lotFor(15, 10);
    const runId = await pendingRun([sold]);
    await adminClient().from("stock_lots").update({ status: "released" }).eq("id", sold);
    const res = await approveCostRunAs(owner.client, runId);
    expect(res.error, "the run is refused").not.toBeNull();
    expect(["CP002", STALE]).toContain(res.error!.code);
    expect((await runStatus(runId)).approval_status).toBe("pending");
  });
});
