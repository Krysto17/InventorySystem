import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Unified hold / release / send-back across settlements, advances, expenses.
// Owner / manager / accountant (site-scoped) may act; send-back returns the item
// to the manager (settlement → Pricing; advance/expense → pending + note).
describe("payable hold / release / send-back", () => {
  let siteId: string, otherSite: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, mgr: TestUser, mgrOther: TestUser, recv: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "hs-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "hs-acct", role: "accounting", siteId });
    mgr = await makeUser({ username: "hs-mgr", role: "manager", siteId });
    mgrOther = await makeUser({ username: "hs-mgr2", role: "manager", siteId: otherSite });
    recv = await makeUser({ username: "hs-recv", role: "receiving", siteId });
    inv = await makeUser({ username: "hs-inv", role: "inventory", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `HS ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function approvedSettlement() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 50, unit_price: 100,
      price_finalized: true, requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: 5000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 5000, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return { visitId: v!.id as string, id: bs!.id as string };
  }
  async function approvedAdvance() {
    const { data } = await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 3000,
      approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return data!.id as string;
  }
  async function approvedExpense() {
    const { data } = await adminClient().from("consumables").insert({
      site_id: siteId, name: "Diesel", category: "fuel_lubricants", amount_naira: 2000,
      entry_date: new Date().toISOString().slice(0, 10), recorded_by: inv.userId,
      approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return data!.id as string;
  }

  // ─── Settlements ───────────────────────────────────────────────────────────
  it("manager holds + releases a settlement", async () => {
    const { id } = await approvedSettlement();
    expect((await mgr.client.rpc("hold_settlement", { p_id: id })).error).toBeNull();
    let st = (await adminClient().from("batch_settlements").select("status, held_by").eq("id", id).single()).data!;
    expect(st.status).toBe("on_hold");
    expect(st.held_by).toBe(mgr.userId);
    expect((await mgr.client.rpc("release_settlement", { p_id: id })).error).toBeNull();
    st = (await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!;
    expect(st.status).toBe("approved");
  });

  it("accountant holds a settlement; owner sends it back → visit to Pricing, settlement voided", async () => {
    const { id, visitId } = await approvedSettlement();
    expect((await acct.client.rpc("hold_settlement", { p_id: id })).error).toBeNull();
    expect((await owner.client.rpc("send_settlement_back", { p_id: id, p_reason: "reprice zircon" })).error).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("pricing");
    const { data: bs } = await adminClient().from("batch_settlements").select("id").eq("id", id);
    expect(bs!.length).toBe(0);
    const { data: lines } = await adminClient().from("visit_materials").select("price_finalized").eq("visit_id", visitId);
    expect(lines!.every((l) => l.price_finalized === false)).toBe(true);
  });

  it("a manager on another site cannot hold a settlement", async () => {
    const { id } = await approvedSettlement();
    expect((await mgrOther.client.rpc("hold_settlement", { p_id: id })).error).not.toBeNull();
  });

  it("inventory cannot hold a settlement", async () => {
    const { id } = await approvedSettlement();
    expect((await inv.client.rpc("hold_settlement", { p_id: id })).error).not.toBeNull();
  });

  it("a settlement with a payment cannot be sent back", async () => {
    const { id } = await approvedSettlement();
    await mgr.client.rpc("record_settlement_payment", { p_settlement_id: id, p_amount: 1000, p_method: "cash" });
    expect((await owner.client.rpc("send_settlement_back", { p_id: id, p_reason: "too late" })).error).not.toBeNull();
  });

  // ─── Advances ──────────────────────────────────────────────────────────────
  it("hold, release, and send an advance back to pending with a note", async () => {
    const a = await approvedAdvance();
    expect((await mgr.client.rpc("hold_advance", { p_id: a })).error).toBeNull();
    expect((await adminClient().from("advances").select("approval_status").eq("id", a).single()).data!.approval_status).toBe("on_hold");
    expect((await owner.client.rpc("send_advance_back", { p_id: a, p_reason: "wrong amount" })).error).toBeNull();
    const row = (await adminClient().from("advances").select("approval_status, correction_note, approved_by").eq("id", a).single()).data!;
    expect(row.approval_status).toBe("pending");
    expect(row.correction_note).toBe("wrong amount");
    expect(row.approved_by).toBeNull();
  });

  it("a send-back needs a reason", async () => {
    const a = await approvedAdvance();
    expect((await owner.client.rpc("send_advance_back", { p_id: a, p_reason: "  " })).error).not.toBeNull();
  });

  // ─── Expenses ──────────────────────────────────────────────────────────────
  it("hold, release, and send an expense back to pending with a note", async () => {
    const e = await approvedExpense();
    expect((await acct.client.rpc("hold_expense", { p_id: e })).error).toBeNull();
    expect((await adminClient().from("consumables").select("approval_status").eq("id", e).single()).data!.approval_status).toBe("on_hold");
    expect((await mgr.client.rpc("release_expense", { p_id: e })).error).toBeNull();
    expect((await mgr.client.rpc("send_expense_back", { p_id: e, p_reason: "duplicate" })).error).toBeNull();
    const row = (await adminClient().from("consumables").select("approval_status, correction_note").eq("id", e).single()).data!;
    expect(row.approval_status).toBe("pending");
    expect(row.correction_note).toBe("duplicate");
  });

  it("inventory cannot hold an expense", async () => {
    const e = await approvedExpense();
    expect((await inv.client.rpc("hold_expense", { p_id: e })).error).not.toBeNull();
  });
});
