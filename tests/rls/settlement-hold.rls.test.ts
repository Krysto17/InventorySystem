import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Owner holds an approved payment (drops it off the accountant's queue) and
// releases it later. Only the owner may hold/release; a held payment can't be
// paid until released.
describe("owner holds / releases an approved settlement", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "hold-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "hold-acct", role: "accounting", siteId });
    recv = await makeUser({ username: "hold-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Hold ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  // A stocked-path visit with an APPROVED (unpaid) settlement.
  async function approvedSettlement() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: 5000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 5000, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return bs!.id as string;
  }

  it("owner holds → on_hold with held_by/held_at stamped", async () => {
    const id = await approvedSettlement();
    const { error } = await owner.client.from("batch_settlements").update({ status: "on_hold" }).eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient().from("batch_settlements").select("status, held_by, held_at").eq("id", id).single();
    expect(data!.status).toBe("on_hold");
    expect(data!.held_by).toBe(owner.userId);
    expect(data!.held_at).not.toBeNull();
  });

  it("owner releases → back to approved, held_* cleared", async () => {
    const id = await approvedSettlement();
    await owner.client.from("batch_settlements").update({ status: "on_hold" }).eq("id", id);
    const { error } = await owner.client.from("batch_settlements").update({ status: "approved" }).eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient().from("batch_settlements").select("status, held_by, held_at").eq("id", id).single();
    expect(data!.status).toBe("approved");
    expect(data!.held_by).toBeNull();
    expect(data!.held_at).toBeNull();
  });

  it("the accountant cannot hold a payment", async () => {
    const id = await approvedSettlement();
    const { error } = await acct.client.from("batch_settlements").update({ status: "on_hold" }).eq("id", id);
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("batch_settlements").select("status").eq("id", id).single();
    expect(data!.status).toBe("approved");
  });

  it("a held payment cannot be paid until released", async () => {
    const id = await approvedSettlement();
    await owner.client.from("batch_settlements").update({ status: "on_hold" }).eq("id", id);
    const { error } = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", id);
    expect(error).not.toBeNull();
    // release, then the accountant can pay
    await owner.client.from("batch_settlements").update({ status: "approved" }).eq("id", id);
    const { error: payErr } = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", id);
    expect(payErr).toBeNull();
  });

  it("a paid payment cannot be held", async () => {
    const id = await approvedSettlement();
    await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", id);
    const { error } = await owner.client.from("batch_settlements").update({ status: "on_hold" }).eq("id", id);
    expect(error).not.toBeNull();
  });
});
