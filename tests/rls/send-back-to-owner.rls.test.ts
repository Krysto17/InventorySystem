import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Accounting returns an owner-approved (not-yet-paid) batch to the owner for
// review: in_accounting → awaiting_price_approval, settlement voided, lines
// unlocked, reason posted. The owner then re-approves or sends it to the manager.
describe("accountant sends a batch back to the owner", () => {
  let siteId: string, otherSite: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, acctOther: TestUser, mgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "sb-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "sb-acct", role: "accounting", siteId });
    acctOther = await makeUser({ username: "sb-acct2", role: "accounting", siteId: otherSite });
    mgr = await makeUser({ username: "sb-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "sb-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `SB ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  // A visit sitting in accounting with an approved (unpaid) settlement + a priced,
  // finalized line + a pricing row (agreed).
  async function inAccountingVisit(paid = false) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    await adminClient().from("visit_materials").insert({
      visit_id: visitId, material_type_id: monazite, weight_kg: 100, unit_price: 900,
      price_finalized: true, requires_analysis: false, recorded_by: recv.userId,
    });
    await adminClient().from("pricing").insert({
      visit_id: visitId, agreement_status: "agreed", unit_price: 900, payment_terms: "immediate", priced_by: mgr.userId,
    });
    await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, materials_total: 90000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 90000, submitted_by: recv.userId,
      status: paid ? "paid" : "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
      ...(paid ? { paid_by: acct.userId, paid_at: new Date().toISOString() } : {}),
    });
    return visitId;
  }

  it("same-site accountant returns it to the owner: state → awaiting_price_approval, settlement voided, lines unlocked, reason logged", async () => {
    const id = await inAccountingVisit();
    const { error } = await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "Monazite underpriced" });
    expect(error).toBeNull();

    const { data: v } = await adminClient().from("visits").select("state").eq("id", id).single();
    expect(v!.state).toBe("awaiting_price_approval");
    const { data: st } = await adminClient().from("batch_settlements").select("id").eq("visit_id", id);
    expect(st!.length).toBe(0);
    const { data: lines } = await adminClient().from("visit_materials").select("price_finalized").eq("visit_id", id);
    expect(lines!.every((l) => l.price_finalized === false)).toBe(true);
    const { data: c } = await adminClient().from("batch_comments").select("body").eq("visit_id", id).single();
    expect(c!.body).toMatch(/Monazite underpriced/);
  });

  it("the owner then sends it on to the manager (awaiting_price_approval → pricing)", async () => {
    const id = await inAccountingVisit();
    await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "please review" });
    const { error } = await owner.client.rpc("reject_pricing", { p_visit_id: id });
    expect(error).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", id).single();
    expect(v!.state).toBe("pricing");
  });

  it("requires a reason", async () => {
    const id = await inAccountingVisit();
    const { error } = await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "  " });
    expect(error).not.toBeNull();
  });

  it("cannot send back a paid batch", async () => {
    const id = await inAccountingVisit(true);
    const { error } = await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "too late" });
    expect(error).not.toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", id).single();
    expect(v!.state).toBe("in_accounting");
  });

  it("an accountant on another site cannot send it back", async () => {
    const id = await inAccountingVisit();
    const { error } = await acctOther.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "not my site" });
    expect(error).not.toBeNull();
  });

  it("a manager cannot send it back (accounting/owner only)", async () => {
    const id = await inAccountingVisit();
    const { error } = await mgr.client.rpc("accountant_send_back_to_owner", { p_visit_id: id, p_reason: "nope" });
    expect(error).not.toBeNull();
  });
});
