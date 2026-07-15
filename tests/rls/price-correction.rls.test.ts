import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Owner / general manager records a price correction only on a PAID visit.
describe("price corrections", () => {
  let siteId: string, newSite: string, monazite: string, supplierId: string;
  let owner: TestUser, gm: TestUser, siteMgr: TestUser, recv: TestUser, acct: TestUser, acctOther: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    const otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "pc-owner", role: "owner", siteId: null });
    gm = await makeUser({ username: "pc-gm", role: "manager", siteId: newSite }); // general manager
    siteMgr = await makeUser({ username: "pc-sm", role: "manager", siteId }); // plain site manager
    recv = await makeUser({ username: "pc-recv", role: "receiving", siteId });
    acct = await makeUser({ username: "pc-acct", role: "accounting", siteId }); // same site as the visit
    acctOther = await makeUser({ username: "pc-acct2", role: "accounting", siteId: otherSite }); // wrong site
    const { data: s } = await adminClient().from("suppliers").insert({ name: `PC ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function visit(paid: boolean) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: paid ? "stocked" : "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: 5000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 5000, submitted_by: recv.userId,
      status: paid ? "paid" : "approved", approved_by: recv.userId, approved_at: new Date().toISOString(),
      ...(paid ? { paid_by: recv.userId, paid_at: new Date().toISOString() } : {}),
    });
    return v!.id as string;
  }

  it("owner records a correction on a paid visit", async () => {
    const id = await visit(true);
    const { error } = await owner.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "overpaid", p_amount: 500, p_reason: "grade re-checked" });
    expect(error).toBeNull();
    const { data } = await adminClient().from("price_corrections").select("direction, amount").eq("visit_id", id).single();
    expect(data!.direction).toBe("overpaid");
    expect(Number(data!.amount)).toBe(500);
  });

  it("general manager can record a correction", async () => {
    const id = await visit(true);
    const { error } = await gm.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "underpaid", p_amount: 200 });
    expect(error).toBeNull();
  });

  it("blocked on a not-yet-paid visit", async () => {
    const id = await visit(false);
    const { error } = await owner.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "overpaid", p_amount: 100 });
    expect(error).not.toBeNull();
  });

  it("a plain site manager cannot record a correction", async () => {
    const id = await visit(true);
    const { error } = await siteMgr.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "overpaid", p_amount: 100 });
    expect(error).not.toBeNull();
  });

  // ─── Underpaid → compensation payout the accountant disburses ──────────────
  async function underpaidCorrection() {
    const id = await visit(true);
    const { data } = await owner.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "underpaid", p_amount: 300 });
    return data as string; // correction id
  }

  it("the same-site accountant marks an underpaid correction paid", async () => {
    const cid = await underpaidCorrection();
    const { error } = await acct.client.rpc("mark_price_correction_paid", { p_id: cid });
    expect(error).toBeNull();
    const { data } = await adminClient().from("price_corrections").select("paid_at, paid_by").eq("id", cid).single();
    expect(data!.paid_at).not.toBeNull();
    expect(data!.paid_by).toBe(acct.userId);
  });

  it("an accountant on another site cannot pay it", async () => {
    const cid = await underpaidCorrection();
    const { error } = await acctOther.client.rpc("mark_price_correction_paid", { p_id: cid });
    expect(error).not.toBeNull();
  });

  it("an overpaid correction is not a payable", async () => {
    const id = await visit(true);
    const { data: cid } = await owner.client.rpc("record_price_correction", { p_visit_id: id, p_direction: "overpaid", p_amount: 250 });
    const { error } = await acct.client.rpc("mark_price_correction_paid", { p_id: cid as string });
    expect(error).not.toBeNull();
  });

  it("a non-accountant cannot mark a compensation paid", async () => {
    const cid = await underpaidCorrection();
    const { error } = await gm.client.rpc("mark_price_correction_paid", { p_id: cid });
    expect(error).not.toBeNull();
  });

  it("cannot pay the same compensation twice", async () => {
    const cid = await underpaidCorrection();
    const first = await acct.client.rpc("mark_price_correction_paid", { p_id: cid });
    expect(first.error).toBeNull();
    const second = await acct.client.rpc("mark_price_correction_paid", { p_id: cid });
    expect(second.error).not.toBeNull();
  });
});
