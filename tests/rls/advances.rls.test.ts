import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("advances RLS", () => {
  let siteAId: string, siteBId: string;
  let mgrA: TestUser, acctA: TestUser, invA: TestUser, mgrB: TestUser, owner: TestUser;
  let supplierId: string;

  async function insertPending(siteId: string, userId: string) {
    const { data, error } = await adminClient()
      .from("advances")
      .insert({
        supplier_id: supplierId,
        site_id: siteId,
        purpose: "Diesel float",
        amount_naira: 50000,
        recorded_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    mgrA  = await makeUser({ username: "adv-mgr-a",  role: "manager",    siteId: siteAId });
    acctA = await makeUser({ username: "adv-acct-a", role: "accounting", siteId: siteAId });
    invA  = await makeUser({ username: "adv-inv-a",  role: "inventory",  siteId: siteAId });
    mgrB  = await makeUser({ username: "adv-mgr-b",  role: "manager",    siteId: siteBId });
    owner = await makeUser({ username: "adv-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Advance Supplier", phone: "0800" })
      .select("id")
      .single();
    supplierId = s!.id as string;
  });

  it("manager at site A can record an advance for site A", async () => {
    const { error } = await mgrA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Cash advance",
      amount_naira: 25000,
      recorded_by: mgrA.userId,
    });
    expect(error).toBeNull();
  });

  it("accountant at site A can also record an advance", async () => {
    const { error } = await acctA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Top-up",
      amount_naira: 10000,
      recorded_by: acctA.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory role cannot record an advance", async () => {
    const { error } = await invA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Should fail",
      amount_naira: 5000,
      recorded_by: invA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("manager at site B cannot record an advance for site A", async () => {
    const { error } = await mgrB.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Cross-site hack",
      amount_naira: 5000,
      recorded_by: mgrB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("manager at site B cannot read site A advances", async () => {
    const id = await insertPending(siteAId, mgrA.userId);
    const { data } = await mgrB.client.from("advances").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("accountant can approve an advance; approved_at is stamped", async () => {
    const id = await insertPending(siteAId, mgrA.userId);
    const { error } = await acctA.client
      .from("advances")
      .update({ approval_status: "approved" })
      .eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("advances")
      .select("approval_status, approved_at")
      .eq("id", id)
      .single();
    expect(data!.approval_status).toBe("approved");
    expect(data!.approved_at).not.toBeNull();
  });

  it("owner can read advances across sites", async () => {
    const id = await insertPending(siteBId, mgrB.userId);
    const { data } = await owner.client.from("advances").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1);
  });

  it("amount must be positive", async () => {
    const { error } = await mgrA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Bad amount",
      amount_naira: -100,
      recorded_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });
});
